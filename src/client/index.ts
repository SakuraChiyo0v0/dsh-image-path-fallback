/**
 * @dsh-external/dsh-image-path-fallback — client 设置页。
 * 提供“图片自动降级为文件路径”的开关、降级模式、提示模板、视觉子代理配置。
 */

import { createElement as h, useEffect, useState } from 'react'
import type { SlotsService } from '@deepseek-ai/dsh-client-ui-slots'

type ClientContext = {
  slots: SlotsService
  connection: {
    rpc: {
      call(
        channel: string,
        endpoint: string,
        payload?: Record<string, unknown>,
        signal?: AbortSignal,
      ): Promise<{ ok: boolean; value?: Record<string, unknown>; error?: { message: string } }>
    }
  }
}

export const inject = ['slots', 'connection']

const RPC_CHANNEL = '/dsh-image-path-fallback'
const RPC_GET = 'imageFallback.get'
const RPC_SET = 'imageFallback.set'

interface Settings {
  enabled: boolean
  mode: 'path' | 'subagent'
  template: string
  visionProvider: string
  visionModel: string
  subagentPrompt: string
}

interface RpcFace {
  rpcCall: (endpoint: string, payload?: Record<string, unknown>) => Promise<Settings>
}

const styles = {
  card: {
    background: 'var(--dsw-alias-bg-layer-1,#fff)',
    border: '1px solid var(--dsw-alias-border-l2,#e5e7eb)',
    borderRadius: 12,
    padding: '16px 20px',
    maxWidth: 640,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: { fontSize: 12, color: 'var(--dsw-alias-label-secondary,#6b7280)' },
  input: {
    font: 'inherit', padding: '6px 8px', borderRadius: 8,
    border: '1px solid var(--dsw-alias-border-l2,#d1d5db)',
    background: 'var(--dsw-alias-bg-layer-1,#fff)',
    color: 'var(--dsw-alias-label-primary,inherit)',
    width: '100%',
    boxSizing: 'border-box',
  },
  textarea: {
    font: 'inherit', padding: '6px 8px', borderRadius: 8,
    border: '1px solid var(--dsw-alias-border-l2,#d1d5db)',
    background: 'var(--dsw-alias-bg-layer-1,#fff)',
    color: 'var(--dsw-alias-label-primary,inherit)',
    width: '100%',
    minHeight: 72,
    boxSizing: 'border-box',
    resize: 'vertical',
  },
  muted: { color: 'var(--dsw-alias-label-tertiary,#8b93a1)', fontSize: 12, lineHeight: 1.5 },
  primary: {
    font: 'inherit', cursor: 'pointer', border: 'none',
    background: 'var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary,#4f6ef7))',
    color: '#fff', height: 36, padding: '0 16px', borderRadius: 999, fontSize: 13,
  },
} as const

function ImageFallbackSettings({ rpcCall }: RpcFace) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const value = await rpcCall(RPC_GET, {})
        if (alive) setSettings(value)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      }
    }
    void load()
    return () => { alive = false }
  }, [rpcCall])

  const set = (patch: Partial<Settings>) => {
    setSettings(prev => prev === null ? prev : { ...prev, ...patch })
    setSaved(false)
  }

  const save = async () => {
    if (settings === null || busy) return
    setBusy(true)
    setError(null)
    try {
      const value = await rpcCall(RPC_SET, settings as unknown as Record<string, unknown>)
      setSettings(value)
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (settings === null) {
    return h('div', { style: styles.card }, h('span', null, '读取中…'))
  }

  return h('div', { style: styles.card },
    h('strong', null, '🖼️ 图片自动降级'),
    h('div', { style: styles.muted },
      '当前模型不支持图片时，自动把用户发送的图片保存为本地文件路径；可选交给一个可识图模型的子代理分析后再把结果给主模型。'),

    h('div', { style: styles.row },
      h('span', null, settings.enabled ? '✅ 已开启' : '⛔ 已关闭'),
      h('button', {
        style: styles.primary,
        disabled: busy,
        onClick: () => set({ enabled: !settings.enabled }),
      }, settings.enabled ? '关闭' : '开启'),
    ),

    h('div', { style: styles.field },
      h('label', { style: styles.label }, '降级模式'),
      h('select', {
        style: styles.input,
        value: settings.mode,
        onChange: (e: { target: { value: string } }) => set({ mode: e.target.value === 'subagent' ? 'subagent' : 'path' }),
      },
        h('option', { value: 'path' }, '仅给文件路径'),
        h('option', { value: 'subagent' }, '用视觉子代理分析'),
      ),
    ),

    settings.mode === 'path'
      ? h('div', { style: styles.field },
          h('label', { style: styles.label }, '路径模式提示模板（可用 {filePath}）'),
          h('textarea', {
            style: styles.textarea,
            value: settings.template,
            onChange: (e: { target: { value: string } }) => set({ template: e.target.value }),
          }),
        )
      : h('div', null,
          h('div', { style: styles.field },
            h('label', { style: styles.label }, '视觉子代理 Provider'),
            h('input', {
              style: styles.input,
              value: settings.visionProvider,
              placeholder: '例如 deepseek / openai / pi-ai',
              onChange: (e: { target: { value: string } }) => set({ visionProvider: e.target.value }),
            }),
          ),
          h('div', { style: styles.field },
            h('label', { style: styles.label }, '视觉子代理 Model'),
            h('input', {
              style: styles.input,
              value: settings.visionModel,
              placeholder: '例如 gpt-4o / qwen-vl-max',
              onChange: (e: { target: { value: string } }) => set({ visionModel: e.target.value }),
            }),
          ),
          h('div', { style: styles.field },
            h('label', { style: styles.label }, '子代理提示词（可用 {filePath}）'),
            h('textarea', {
              style: styles.textarea,
              value: settings.subagentPrompt,
              onChange: (e: { target: { value: string } }) => set({ subagentPrompt: e.target.value }),
            }),
          ),
        ),

    h('div', { style: styles.row },
      h('span', { style: styles.muted }, saved ? '✅ 已保存' : '修改后记得保存'),
      h('button', { style: styles.primary, disabled: busy, onClick: save }, busy ? '保存中…' : '保存'),
    ),

    error ? h('div', { style: { color: 'var(--dsw-alias-state-error-primary,#dc2626)', fontSize: 12 } }, `❌ ${error}`) : null,
  )
}

export function apply(ctx: ClientContext): void {
  const rpcCall = async (endpoint: string, payload?: Record<string, unknown>) => {
    const res = await ctx.connection.rpc.call(RPC_CHANNEL, endpoint, payload)
    if (!res.ok || res.value === undefined) {
      throw new Error(res.error?.message ?? 'RPC failed')
    }
    return res.value as unknown as Settings
  }

  ctx.effect(() => ctx.slots.inject('settings.section', () =>
    ctx.slots.register({
      name: 'settings.section',
      id: 'dsh-image-path-fallback',
      order: 50,
      label: () => '图片降级',
      inject: () => ({ rpcCall }),
    }, ImageFallbackSettings),
  ), '@dsh-external/dsh-image-path-fallback: settings section')
}
