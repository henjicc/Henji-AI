import { useEffect, useState } from 'react'
import { Check, ChevronDown, ChevronRight, LoaderCircle, CircleAlert } from 'lucide-react'
import { UI_TEXT_SECONDARY_CLASS, UiButton } from '@/components/ui'
import type { EmbeddedAgentMessage } from '@/core/assistant/embeddedAgent'
import { AssistantMarkdown } from '../conversation/AssistantMarkdown'
import { AssistantMessageAttachments } from '../conversation/AssistantMessageAttachments'

/**
 * 用户消息：右对齐的抬升一级气泡（与输入框同一档 raised），不用强调色实底——
 * 强调色实底在这块面板里只属于唯一主动作“发送”（重要记录 003/012）。左侧留出一档空白，长消息不贴满整行。
 */
export function EmbeddedUserMessage({ message }: { message: Pick<EmbeddedAgentMessage, 'text' | 'attachments'> }): JSX.Element {
  return <div className="flex min-w-0 justify-end pl-8" data-embedded-user-message>
    <div className="min-w-0 rounded-lg bg-raised px-3 py-2 text-text1">
      <p className="whitespace-pre-wrap break-words text-13 leading-6 [overflow-wrap:anywhere]">{message.text}</p>
      {message.attachments?.length ? <AssistantMessageAttachments attachments={message.attachments} /> : null}
    </div>
  </div>
}

/** 过程区的展开开关：静默文字按钮，左缘用负外边距对齐正文列（按钮内边距不改外观）。 */
function ProcessToggle({ expanded, label, onClick }: { expanded: boolean; label: string; onClick(): void }): JSX.Element {
  return <UiButton size="sm" className="-ml-2 gap-1" aria-expanded={expanded} onClick={onClick}>
    {expanded ? <ChevronDown aria-hidden="true" size={14} /> : <ChevronRight aria-hidden="true" size={14} />}{label}
  </UiButton>
}

function ToolStatusIcon({ status }: { status: EmbeddedAgentMessage['status'] }): JSX.Element {
  if (status === 'failed') return <CircleAlert aria-hidden="true" size={14} className="shrink-0 text-danger-text" />
  if (status === 'completed') return <Check aria-hidden="true" size={14} className="shrink-0 text-text3" />
  return <LoaderCircle aria-hidden="true" size={14} className="shrink-0 text-accent-text motion-safe:animate-spin" />
}

function AssistantTurn({ messages, busy, onToggle }: { messages: EmbeddedAgentMessage[]; busy: boolean; onToggle(): void }): JSX.Element {
  const hasAnswer = messages.some(message => message.kind === 'answer' || !message.kind)
  const [expanded, setExpanded] = useState(!hasAnswer)
  const [thinkingExpanded, setThinkingExpanded] = useState(false)
  useEffect(() => { setExpanded(!hasAnswer) }, [hasAnswer])
  const process = messages.filter(message => message.kind === 'process' || message.kind === 'tool')
  const answers = messages.filter(message => message.kind === 'answer' || !message.kind)
  const thinking = process.filter(message => message.kind === 'process')
  // 同一轮只保留一个同名操作提示；失败不能被后续成功或运行状态掩盖。
  const tools = new Map<string, EmbeddedAgentMessage>()
  for (const message of process) {
    if (message.kind !== 'tool') continue
    const previous = tools.get(message.text)
    const status = previous?.status === 'failed' || message.status === 'failed' ? 'failed'
      : previous?.status === 'running' || message.status === 'running' ? 'running' : message.status
    tools.set(message.text, { ...message, id: previous?.id ?? message.id, status })
  }
  return <div className="min-w-0 space-y-3" data-embedded-assistant-turn>
    {process.length ? <div>
      <ProcessToggle expanded={expanded} label={hasAnswer ? '查看过程' : '处理过程'}
        onClick={() => { onToggle(); setExpanded(value => !value) }} />
      {/* 展开的过程挂在开关下方，用一条左侧细线表达从属关系（分隔线，不是框） */}
      {expanded ? <div className="ml-1.5 mt-1 space-y-2 border-l border-line-strong pl-3 text-text2" data-embedded-process>
        {thinking.length ? <div>
          <ProcessToggle expanded={thinkingExpanded} label={busy && !hasAnswer ? '正在思考' : '思考过程'}
            onClick={() => { onToggle(); setThinkingExpanded(value => !value) }} />
          {thinkingExpanded ? <div className="space-y-2 pb-1 text-text2" data-embedded-thinking>
            {thinking.map(message => <AssistantMarkdown key={message.id} compact tone="secondary">{message.text}</AssistantMarkdown>)}
          </div> : null}
        </div> : null}
        {[...tools.values()].map(message => <div key={message.id} className={`flex items-start gap-2 ${UI_TEXT_SECONDARY_CLASS}`}>
            <span className="flex h-4 items-center"><ToolStatusIcon status={message.status} /></span>
            <span className="min-w-0 break-words">{message.text}{message.status === 'failed' ? ' · 未完成' : ''}</span>
          </div>)}
      </div> : null}
    </div> : null}
    {answers.map(message => <div key={message.id} data-embedded-answer><AssistantMarkdown>{message.text}</AssistantMarkdown></div>)}
  </div>
}

export function EmbeddedTranscript({ messages, busy = false, onToggle }: { messages: EmbeddedAgentMessage[]; busy?: boolean; onToggle(): void }): JSX.Element {
  const groups: Array<{ id: string; user?: EmbeddedAgentMessage; replies: EmbeddedAgentMessage[] }> = []
  for (const message of messages) {
    if (message.role === 'user') groups.push({ id: message.id, user: message, replies: [] })
    else {
      if (!groups.length) groups.push({ id: message.id, replies: [] })
      groups[groups.length - 1].replies.push(message)
    }
  }
  return <>{groups.map((group, index) => <div key={group.id} className="space-y-4">
    {group.user ? <EmbeddedUserMessage message={group.user} /> : null}
    {group.replies.length ? <AssistantTurn messages={group.replies} busy={busy && index === groups.length - 1} onToggle={onToggle} /> : null}
  </div>)}</>
}
