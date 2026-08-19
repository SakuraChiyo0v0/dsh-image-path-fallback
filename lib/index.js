/**
 * @dsh-external/dsh-image-path-fallback
 *
 * 宿主侧插件：
 * 1. 包装 ctx.llm.resolveModelInfo，让不支持图片的模型在准入阶段“看起来支持图片”
 *    （否则核心 api-proxy 会在入口直接拒绝）。
 * 2. 监听 agent/pre-step，在真实模型调用前把 image block 替换成“图片文件路径 + 提示”，
 *    让纯文本模型也能借助识图 skill 读取图片。
 * 3. 提供设置页开关，持久化到 ~/.dsh/dsh-image-path-fallback/settings.json。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { homedir } from 'node:os';
import z from 'schemastery';
export const name = '@dsh-external/dsh-image-path-fallback';
export const inject = ['connection', 'llm', 'attachments'];
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
function dshHome() {
    return process.env.DSH_HOME || join(homedir(), '.dsh');
}
function settingsPath() {
    return join(dshHome(), 'dsh-image-path-fallback', 'settings.json');
}
async function readEnabled() {
    try {
        const raw = JSON.parse(await readFile(settingsPath(), 'utf8'));
        return raw.enabled !== false;
    }
    catch {
        return true;
    }
}
async function writeEnabled(enabled) {
    const file = settingsPath();
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ enabled }, null, 2), 'utf8');
}
function isImageCapable(info) {
    return info?.inputModalities?.includes('image') === true;
}
/** Wrap resolveModelInfo so image admission passes; real conversion happens in agent/pre-step. */
function patchModelCapability(ctx) {
    const llm = ctx.llm;
    const original = llm.resolveModelInfo.bind(llm);
    llm.resolveModelInfo = (async (provider, model, signal) => {
        const info = await original(provider, model, signal);
        if (!(await readEnabled()))
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
/** Map attachment media type to a file extension. */
function extensionFor(mediaType) {
    return MEDIA_EXT[mediaType] ?? (extname(mediaType) || '.img');
}
/** Convert image blocks in one user message to text file-path notes. */
async function convertMessageImages(ctx, message, baseDir) {
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
        next.push({
            type: 'text',
            text: `[用户发来一张图片，已保存到: ${filePath}]\n`
                + `请使用你的识图 skill（或可用的图片读取工具）读取该文件，获取图片内容后继续回答。`,
        });
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
                return ok({ enabled: await readEnabled() });
            }
            if (endpoint === RPC_SET) {
                const enabled = payload.enabled === true;
                await writeEnabled(enabled);
                return ok({ enabled });
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
        // 让核心 api-proxy 的图片准入检查放行（内部按开关动态生效）
        disposers.push(patchModelCapability(ctx));
        // 在模型真正调用前把 image block 替换成文件路径（内部按开关动态生效）
        disposers.push(ctx.on('agent/pre-step', (async (payload, next) => {
            if (!(await readEnabled()))
                return next();
            const baseDir = payload?.agent?.session?.header?.cwd ?? dshHome();
            const converted = [];
            let changed = false;
            for (const message of payload?.messages ?? []) {
                const result = await convertMessageImages(ctx, message, baseDir);
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