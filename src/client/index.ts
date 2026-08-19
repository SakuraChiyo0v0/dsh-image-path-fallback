/**
 * @dsh-external/dsh-image-path-fallback — client 设置页开关。
 * 提供“图片自动降级为文件路径”的开关，通过 loopback RPC 读取/写入宿主状态。
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
      ): Promise<{ ok: boolean; value?: { enabled: boolean }; error?: { message: string } }>
    }
  }
}

export const inject = ['slots', 'connection']

const RPC_CHANNEL = '/dsh-image-path-fallback'
const RPC_GET = 'imageFallback.get'
const RPC_SET = 'imageFallback.set'

interface RpcFace {
  rpcCall: (endpoint: string, payload?: Record<string, unknown>) => Promise<{ enabled: boolean }>
}

const styles = {
  card: {
    background: 'var(--dsw-alias-bg-layer-1,#fff)',
    border: '1px solid var(--dsw-alias-border-l2,#e5e7eb)',
    borderRadius: 12,
    padding: '16px 20px',
    maxWidth: 520,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  muted: { color: 'var(--dsw-alias-label-tertiary,#8b93a1)', fontSize: 12, lineHeight: 1.5 },
  primary: {
    font: 'inherit', cursor: 'pointer', border: 'none',
    background: 'var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary,#4f6ef7))',
    color: '#fff', height: 36, padding: '0 16px', borderRadius: 999, fontSize: 13,
  },
} as const

function ImageFallbackSettings({ rpcCall }: RpcFace) {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const value = await rpcCall(RPC_GET, {})
        if (alive) setEnabled(value.enabled)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      }
    }
    void load()
    return () => { alive = false }
  }, [rpcCall])

  const toggle = async () => {
    if (enabled === null || busy) return
    setBusy(true)
    setError(null)
    try {
      const value = await rpcCall(RPC_SET, { enabled: !enabled })
      setEnabled(value.enabled)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return h('div', { style: styles.card },
    h('strong', null, '🖼️ 图片自动降级为文件路径'),
    h('div', { style: styles.muted },
      '当当前模型不支持图片时，自动把用户发送的图片保存为本地文件路径，并提示模型使用识图 skill 读取该文件。'),
    h('div', { style: styles.row },
      h('span', null, enabled === null ? '读取中…' : (enabled ? '✅ 已开启' : '⛔ 已关闭')),
      h('button', {
        style: styles.primary,
        disabled: enabled === null || busy,
        onClick: toggle,
      }, busy ? '处理中…' : (enabled ? '关闭' : '开启')),
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
    return res.value
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
