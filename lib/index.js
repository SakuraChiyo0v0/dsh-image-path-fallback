/**
 * @dsh-external/dsh-image-path-fallback
 *
 * 宿主侧插件：
 * 1. 包装 ctx.llm.resolveModelInfo，让不支持图片的模型在准入阶段“看起来支持图片”
 * 2. 监听 agent/pre-step，把 image block 替换成可自定义的文案；可选模式：仅给文件路径，
 *    或调用一个可识图模型的子代理分析图片后把结果文本注入主对话。
 * 3. 设置页开关与模板配置持久化到 ~/.dsh/dsh-image-path-fallback/settings.json。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { homedir } from 'node:os';
import z from 'schemastery';
export const name = '@dsh-external/dsh-image-path-fallback';
export const inject = ['connection', 'llm', 'attachments', 'subagents'];
export const Config = z.object({
    enabled: z.boolean().default(true),
});
const RPC_CHANNEL = '/dsh-image-path-fallback';
const RPC_GET = 'imageFallback.get';
const RPC_SET = 'imageFallback.set';
const MEDIA_EXT = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
};
const DEFAULT_SETTINGS = {
    enabled: true,
    mode: 'path',
    template: '[用户发来一张图片，已保存到: {filePath}]\n'
        + '请使用你的识图 skill（或可用的图片读取工具）读取该文件，获取图片内容后继续回答。',
    visionProvider: '',
    visionModel: '',
    subagentPrompt: '请分析这张图片并详细描述其内容，供一个不支持视觉的模型参考。图片文件路径：{filePath}',
};
function dshHome() {
    return process.env.DSH_HOME || join(homedir(), '.dsh');
}
function settingsPath() {
    return join(dshHome(), 'dsh-image-path-fallback', 'settings.json');
}
async function readSettings() {
    try {
        const raw = JSON.parse(await readFile(settingsPath(), 'utf8'));
        return { ...DEFAULT_SETTINGS, ...raw };
    }
    catch {
        return { ...DEFAULT_SETTINGS };
    }
}
async function writeSettings(settings) {
    const file = settingsPath();
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(settings, null, 2), 'utf8');
}
function isImageCapable(info) {
    return info?.inputModalities?.includes('image') === true;
}
/** Wrap resolveModelInfo so image admission passes; real conversion happens in agent/pre-step. */
function patchModelCapability(ctx) {
    const llm = ctx.llm;
    const original = llm.resolveModelInfo.bind(llm);
    llm.resolveModelInfo = (async (provider, model, signal) => {
        const settings = await readSettings();
        const info = await original(provider, model, signal);
        if (!settings.enabled)
            return info;
        if (!isImageCapable(info)) {
            return { ...info, inputModalities: [...(info.inputModalities ?? []), 'image'] };
        }
        return info;
    });
    return () => {
        llm.resolveModelInfo = original;
    };
}
function extensionFor(mediaType) {
    return MEDIA_EXT[mediaType] ?? (extname(mediaType) || '.img');
}
function renderTemplate(template, vars) {
    let text = template;
    for (const [key, value] of Object.entries(vars)) {
        text = text.replaceAll(`{${key}}`, value);
    }
    return text;
}
/** Auto-select the first model in the system catalog that declares image input. */
async function findVisionModel(ctx) {
    const llm = ctx.llm;
    try {
        for (const provider of llm.listProviders()) {
            const models = await llm.listModels(provider.id).catch(() => []);
            for (const model of models) {
                if (model.inputModalities?.includes('image') === true) {
                    return { provider: provider.id, model: model.id };
                }
            }
        }
    }
    catch { /* ignore */ }
    return null;
}
/** Run a one-shot vision subagent and return its text output. */
async function runVisionSubagent(ctx, parentAgent, signal, filePath, settings) {
    const subagents = ctx.subagents;
    let provider = settings.visionProvider;
    let model = settings.visionModel;
    if (!provider || !model) {
        const auto = await findVisionModel(ctx);
        if (auto === null) {
            throw new Error('未找到支持图片输入的系统模型；请在设置中手动填写视觉 Provider/Model');
        }
        provider = auto.provider;
        model = auto.model;
    }
    const run = await subagents.start('spawn', {
        label: 'image-fallback-vision',
        prompt: [{ type: 'text', text: renderTemplate(settings.subagentPrompt, { filePath }) }],
        parent: parentAgent,
        signal,
        agentOptions: { provider, model },
    });
    const result = await run.result;
    const text = (result.output ?? [])
        .filter((block) => block.type === 'text' && typeof block.text === 'string')
        .map(block => block.text)
        .join('\n')
        .trim();
    return text || '（视觉子代理没有返回文本内容）';
}
/** Convert image blocks in one user message to text file-path notes / subagent analysis. */
async function convertMessageImages(ctx, message, baseDir, parentAgent, signal, settings) {
    const content = message.content;
    let changed = false;
    const next = [];
    for (const block of content) {
        if (block.type !== 'image' || block.attachment === undefined) {
            next.push(block);
            continue;
        }
        const ref = block.attachment;
        const attachments = ctx.attachments;
        const stored = await attachments.readImage(ref);
        const dir = join(baseDir, '.dsh-image-fallback');
        await mkdir(dir, { recursive: true });
        const safeId = String(ref.attachmentId).replace(/[^a-zA-Z0-9]/g, '_');
        const filePath = join(dir, `${safeId}${extensionFor(ref.mediaType)}`);
        await writeFile(filePath, stored.data);
        if (settings.mode === 'subagent' && settings.visionProvider && settings.visionModel) {
            let analysis = '';
            try {
                analysis = await runVisionSubagent(ctx, parentAgent, signal, filePath, settings);
            }
            catch (error) {
                analysis = `（视觉子代理分析失败：${error instanceof Error ? error.message : String(error)}）`;
            }
            next.push({
                type: 'text',
                text: `[用户发来一张图片，已保存到: ${filePath}]\n`
                    + `[视觉子代理分析结果]\n${analysis}`,
            });
        }
        else {
            next.push({
                type: 'text',
                text: renderTemplate(settings.template, { filePath }),
            });
        }
        changed = true;
    }
    return changed ? { content: next } : { content };
}
function ok(value) {
    return { ok: true, value };
}
function fail(code, message) {
    return { ok: false, error: { code, message, details: {} } };
}
function installRpc(ctx) {
    const connection = ctx.connection;
    if (!connection?.rpc?.handle) {
        ctx.logger?.warn?.('dsh-image-path-fallback: connection RPC unavailable — settings toggle disabled');
        return () => { };
    }
    return connection.rpc.handle(RPC_CHANNEL, async (endpoint, payload) => {
        try {
            if (endpoint === RPC_GET) {
                return ok(await readSettings());
            }
            if (endpoint === RPC_SET) {
                const current = await readSettings();
                const next = {
                    ...current,
                    ...payload,
                    mode: payload.mode === 'subagent' ? 'subagent' : 'path',
                };
                await writeSettings(next);
                return ok(next);
            }
            return fail('bad-request', `Unknown endpoint: ${endpoint}`);
        }
        catch (error) {
            ctx.logger?.error?.('dsh-image-path-fallback: rpc %s failed: %s', endpoint, error instanceof Error ? error.message : String(error));
            return fail('internal', error instanceof Error ? error.message : String(error));
        }
    }, { authority: 'loopback' });
}
export function apply(ctx, _config) {
    const disposers = [];
    {
        disposers.push(patchModelCapability(ctx));
        disposers.push(ctx.on('agent/pre-step', (async (payload, next) => {
            const settings = await readSettings();
            if (!settings.enabled)
                return next();
            const baseDir = payload?.agent?.session?.header?.cwd ?? dshHome();
            const converted = [];
            let changed = false;
            for (const message of payload?.messages ?? []) {
                const result = await convertMessageImages(ctx, message, baseDir, payload?.agent, payload?.signal, settings);
                if (result.content !== message.content)
                    changed = true;
                converted.push({ ...message, content: result.content });
            }
            if (!changed)
                return next();
            return {
                kind: 'enter',
                messages: converted,
            };
        })));
    }
    disposers.push(installRpc(ctx));
    ctx.effect(() => () => {
        for (const dispose of disposers.reverse()) {
            try {
                dispose();
            }
            catch { /* ignore */ }
        }
    }, 'dsh-image-path-fallback: dispose');
}
//# sourceMappingURL=index.js.map