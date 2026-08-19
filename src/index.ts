/**
 * @dsh-external/dsh-image-path-fallback
 *
 * 宿主侧插件：
 * 1. 包装 ctx.llm.resolveModelInfo，让不支持图片的模型在准入阶段“看起来支持图片”
 * 2. 监听 agent/pre-step，把 image block 替换成可自定义的文案；可选模式：仅给文件路径，
 *    或调用一个可识图模型的子代理分析图片后把结果文本注入主对话。
 * 3. 设置页开关与模板配置持久化到 ~/.dsh/dsh-image-path-fallback/settings.json。
 */

import type { Context } from 'cordis'
// Type-only: brings the `agent/pre-step` event and attachment service types into this program.
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-attachment'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { homedir } from 'node:os'
import z from 'schemastery'

export const name = '@dsh-external/dsh-image-path-fallback'
export const inject = ['connection', 'llm', 'attachments', 'subagents']

export interface Config {
  enabled: boolean
}

export const Config = z.object({
  enabled: z.boolean().default(true),
})

const RPC_CHANNEL = '/dsh-image-path-fallback'
const RPC_GET = 'imageFallback.get'
const RPC_SET = 'imageFallback.set'

const MEDIA_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
}

interface Settings {
  enabled: boolean
  mode: 'path' | 'subagent'
  template: string
  visionProvider: string
  visionModel: string
  subagentPrompt: string
}

const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  mode: 'path',
  template:
    '[用户发来一张图片，已保存到: {filePath}]\n'
    + '请使用你的识图 skill（或可用的图片读取工具）读取该文件，获取图片内容后继续回答。',
  visionProvider: '',
  visionModel: '',
  subagentPrompt:
    '请分析这张图片并详细描述其内容，供一个不支持视觉的模型参考。图片文件路径：{filePath}',
}

function dshHome(): string {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

function settingsPath(): string {
  return join(dshHome(), 'dsh-image-path-fallback', 'settings.json')
}

async function readSettings(): Promise<Settings> {
  try {
    const raw = JSON.parse(await readFile(settingsPath(), 'utf8')) as Partial<Settings>
    return { ...DEFAULT_SETTINGS, ...raw }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

async function writeSettings(settings: Settings): Promise<void> {
  const file = settingsPath()
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(settings, null, 2), 'utf8')
}

function isImageCapable(info: { inputModalities?: readonly string[] } | undefined): boolean {
  return info?.inputModalities?.includes('image') === true
}

/** Wrap resolveModelInfo so image admission passes; real conversion happens in agent/pre-step. */
function patchModelCapability(ctx: Context): () => void {
  const llm = (ctx as unknown as { llm: { resolveModelInfo: (...args: unknown[]) => Promise<{ inputModalities?: readonly string[] }> } }).llm
  const original = llm.resolveModelInfo.bind(llm)
  llm.resolveModelInfo = (async (provider: string, model: string, signal?: AbortSignal) => {
    const settings = await readSettings()
    const info = await original(provider, model, signal)
    if (!settings.enabled) return info
    if (!isImageCapable(info)) {
      return { ...info, inputModalities: [...(info.inputModalities ?? []), 'image'] }
    }
    return info
  }) as typeof llm.resolveModelInfo
  return () => {
    llm.resolveModelInfo = original
  }
}

function extensionFor(mediaType: string): string {
  return MEDIA_EXT[mediaType] ?? (extname(mediaType) || '.img')
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  let text = template
  for (const [key, value] of Object.entries(vars)) {
    text = text.replaceAll(`{${key}}`, value)
  }
  return text
}

/** Auto-select the first model in the system catalog that declares image input. */
async function findVisionModel(ctx: Context): Promise<{ provider: string; model: string } | null> {
  const llm = (ctx as unknown as {
    llm: {
      listProviders(): Array<{ id: string }>
      listModels(provider: string): Promise<Array<{ id: string; inputModalities?: readonly string[] }>>
    }
  }).llm
  try {
    for (const provider of llm.listProviders()) {
      const models = await llm.listModels(provider.id).catch(() => [])
      for (const model of models) {
        if (model.inputModalities?.includes('image') === true) {
          return { provider: provider.id, model: model.id }
        }
      }
    }
  } catch { /* ignore */ }
  return null
}

/** Run a one-shot vision subagent and return its text output. */
async function runVisionSubagent(
  ctx: Context,
  parentAgent: unknown,
  signal: AbortSignal | undefined,
  filePath: string,
  settings: Settings,
): Promise<string> {
  const subagents = (ctx as unknown as {
    subagents: {
      start(
        provider: string,
        request: {
          label?: string
          prompt: Array<{ type: 'text'; text: string }>
          parent: unknown
          signal?: AbortSignal
          agentOptions?: { provider: string; model: string }
        },
      ): Promise<{ result: Promise<{ output: Array<{ type: string; text?: string }> }> }>
    }
  }).subagents
  let provider = settings.visionProvider
  let model = settings.visionModel
  if (!provider || !model) {
    const auto = await findVisionModel(ctx)
    if (auto === null) {
      throw new Error('未找到支持图片输入的系统模型；请在设置中手动填写视觉 Provider/Model')
    }
    provider = auto.provider
    model = auto.model
  }
  const run = await subagents.start('spawn', {
    label: 'image-fallback-vision',
    prompt: [{ type: 'text', text: renderTemplate(settings.subagentPrompt, { filePath }) }],
    parent: parentAgent,
    signal,
    agentOptions: { provider, model },
  })
  const result = await run.result
  const text = (result.output ?? [])
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
    .trim()
  return text || '（视觉子代理没有返回文本内容）'
}

/** Convert image blocks in one user message to text file-path notes / subagent analysis. */
async function convertMessageImages(
  ctx: Context,
  message: { content: readonly unknown[] },
  baseDir: string,
  parentAgent: unknown,
  signal: AbortSignal | undefined,
  settings: Settings,
): Promise<{ content: unknown[] }> {
  const content = message.content as Array<{ type: string; attachment?: { attachmentId: string; mediaType: string } }>
  let changed = false
  const next: unknown[] = []
  for (const block of content) {
    if (block.type !== 'image' || block.attachment === undefined) {
      next.push(block)
      continue
    }
    const ref = block.attachment
    const attachments = (ctx as unknown as { attachments: { readImage(ref: unknown, signal?: AbortSignal): Promise<{ data: Uint8Array }> } }).attachments
    const stored = await attachments.readImage(ref)
    const dir = join(baseDir, '.dsh-image-fallback')
    await mkdir(dir, { recursive: true })
    const safeId = String(ref.attachmentId).replace(/[^a-zA-Z0-9]/g, '_')
    const filePath = join(dir, `${safeId}${extensionFor(ref.mediaType)}`)
    await writeFile(filePath, stored.data)

    if (settings.mode === 'subagent' && settings.visionProvider && settings.visionModel) {
      let analysis = ''
      try {
        analysis = await runVisionSubagent(ctx, parentAgent, signal, filePath, settings)
      } catch (error) {
        analysis = `（视觉子代理分析失败：${error instanceof Error ? error.message : String(error)}）`
      }
      next.push({
        type: 'text',
        text:
          `[用户发来一张图片，已保存到: ${filePath}]\n`
          + `[视觉子代理分析结果]\n${analysis}`,
      })
    } else {
      next.push({
        type: 'text',
        text: renderTemplate(settings.template, { filePath }),
      })
    }
    changed = true
  }
  return changed ? { content: next } : { content }
}

function ok(value: unknown) {
  return { ok: true as const, value }
}

function fail(code: string, message: string) {
  return { ok: false as const, error: { code, message, details: {} } }
}

function installRpc(ctx: Context): () => void {
  const connection = (ctx as unknown as {
    connection: {
      rpc: {
        handle(
          channel: string,
          handler: (endpoint: string, payload: Record<string, unknown>) => Promise<unknown>,
          options?: { authority: string },
        ): () => void
      }
    }
  }).connection
  if (!connection?.rpc?.handle) {
    ctx.logger?.warn?.('dsh-image-path-fallback: connection RPC unavailable — settings toggle disabled')
    return () => {}
  }
  return connection.rpc.handle(
    RPC_CHANNEL,
    async (endpoint: string, payload: Record<string, unknown>) => {
      try {
        if (endpoint === RPC_GET) {
          return ok(await readSettings())
        }
        if (endpoint === RPC_SET) {
          const current = await readSettings()
          const next: Settings = {
            ...current,
            ...(payload as Partial<Settings>),
            mode: payload.mode === 'subagent' ? 'subagent' : 'path',
          }
          await writeSettings(next)
          return ok(next)
        }
        return fail('bad-request', `Unknown endpoint: ${endpoint}`)
      } catch (error) {
        ctx.logger?.error?.('dsh-image-path-fallback: rpc %s failed: %s', endpoint, error instanceof Error ? error.message : String(error))
        return fail('internal', error instanceof Error ? error.message : String(error))
      }
    },
    { authority: 'loopback' },
  )
}

export function apply(ctx: Context, _config: Config): void {
  const disposers: Array<() => void> = []

  {
    disposers.push(patchModelCapability(ctx))

    disposers.push(ctx.on('agent/pre-step', (async (payload: any, next: any) => {
      const settings = await readSettings()
      if (!settings.enabled) return next()
      const baseDir = payload?.agent?.session?.header?.cwd ?? dshHome()
      const converted: Array<{ content: unknown[] }> = []
      let changed = false
      for (const message of payload?.messages ?? []) {
        const result = await convertMessageImages(
          ctx,
          message,
          baseDir,
          payload?.agent,
          payload?.signal,
          settings,
        )
        if (result.content !== message.content) changed = true
        converted.push({ ...message, content: result.content })
      }
      if (!changed) return next()
      return {
        kind: 'enter',
        messages: converted,
      }
    }) as any))
  }

  disposers.push(installRpc(ctx))

  ctx.effect(() => () => {
    for (const dispose of disposers.reverse()) {
      try { dispose() } catch { /* ignore */ }
    }
  }, 'dsh-image-path-fallback: dispose')
}
