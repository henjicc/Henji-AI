import { useEffect, useState } from 'react'
import { UiButton, UiError } from '@/components/ui'
import type { EmbeddedAgentSession } from '@/core/assistant/embeddedAgent'
import { getPlatform } from '@/platform/runtime'
import { reportEmbeddedAgentError, useEmbeddedAgent } from './controller'

export function EmbeddedHistory({ visible, onOpen }: { visible: boolean; onOpen(): void }): JSX.Element {
  const state = useEmbeddedAgent()
  const [sessions, setSessions] = useState<EmbeddedAgentSession[]>([])
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!visible || state.busy) return
    let disposed = false
    setLoading(true)
    void getPlatform().embeddedAgent.sessions().then((items) => { if (!disposed) setSessions(items) }, reportEmbeddedAgentError)
      .finally(() => { if (!disposed) setLoading(false) })
    return () => { disposed = true }
  }, [visible, state.busy])
  return <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
    {state.error ? <UiError message={state.error} size="xs" /> : null}
    {state.busy ? <p className="text-sm text-text-muted">请先停止当前回复，再打开其他对话。</p> : null}
    {loading ? <p className="text-sm text-text-muted">正在读取对话…</p> : !sessions.length ? <p className="text-sm text-text-muted">还没有保存的对话。</p> : null}
    {/* ui-surface-allow 两行的历史对话列表行（行高随内容），交 2.2 列表行组件 */}
    {sessions.map((session) => <UiButton key={session.id} className="h-auto shrink-0 justify-start py-1.5 text-left" disabled={state.busy} onClick={() => {
      void getPlatform().embeddedAgent.openSession(session.id).then(onOpen, reportEmbeddedAgentError)
    }}><span className="min-w-0"><span className="block truncate">{session.title}</span><span className="block text-xs text-text-muted">{new Date(session.updatedAt).toLocaleString()}</span></span></UiButton>)}
  </div>
}
