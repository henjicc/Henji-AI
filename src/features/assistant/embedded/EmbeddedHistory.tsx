import { useEffect, useState } from 'react'
import { UI_TEXT_SECONDARY_CLASS, UiEmpty, UiError, UiLoading, UiOptionButton } from '@/components/ui'
import { assistantErrorMessage } from '@/core/assistant/assistantErrorPresentation'
import type { EmbeddedAgentSession } from '@/core/assistant/embeddedAgent'
import { getPlatform } from '@/platform/runtime'
import { reportEmbeddedAgentError, useEmbeddedAgent } from './controller'

const updatedAtFormat = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export function EmbeddedHistory({ visible, onOpen }: { visible: boolean; onOpen(): void }): JSX.Element {
  const state = useEmbeddedAgent()
  const [sessions, setSessions] = useState<EmbeddedAgentSession[]>([])
  const [loading, setLoading] = useState(false)
  // 只有“回复中”才挡住读取；自己发起的列表读取会让主进程进入切换中（busy + switching），不能因此取消自己再重读。
  const replying = state.busy && !state.switching
  useEffect(() => {
    if (!visible || replying) return
    let disposed = false
    setLoading(true)
    void getPlatform().embeddedAgent.sessions().then((items) => { if (!disposed) setSessions(items) }, reportEmbeddedAgentError)
      .finally(() => { if (!disposed) setLoading(false) })
    return () => { disposed = true }
  }, [visible, replying])
  return <div className="ui-scrollbar flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2">
    {state.error ? <UiError size="xs" align="start" title="操作未完成" message={assistantErrorMessage(state.error)} className="px-2" /> : null}
    {replying ? <p className={`px-2 py-1.5 ${UI_TEXT_SECONDARY_CLASS}`}>请先停止当前回复，再打开其他对话。</p> : null}
    {loading && !sessions.length ? <UiLoading size="xs" message="正在读取对话" />
      : !loading && !sessions.length ? <UiEmpty size="sm" title="还没有保存的对话" description="发送第一条消息后，对话会自动保存在这里。" /> : null}
    {/* 两行的历史对话列表行：menu 选项静息无底、悬停出底；当前对话用单选的淡强调底标出，高度随内容 */}
    {sessions.map((session) => <UiOptionButton key={session.id} variant="menu" active={session.id === state.sessionId}
      aria-current={session.id === state.sessionId ? 'true' : undefined}
      className="w-full shrink-0 justify-start" title={session.title} disabled={state.busy} onClick={() => {
        void getPlatform().embeddedAgent.openSession(session.id).then(onOpen, reportEmbeddedAgentError)
      }}>
      <span className="min-w-0">
        <span className="block truncate">{session.title}</span>
        <span className={`block ${UI_TEXT_SECONDARY_CLASS}`}>{updatedAtFormat.format(new Date(session.updatedAt))}</span>
      </span>
    </UiOptionButton>)}
  </div>
}
