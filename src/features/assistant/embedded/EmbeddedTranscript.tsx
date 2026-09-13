import { useEffect, useState } from 'react'
import { Check, ChevronDown, ChevronRight, LoaderCircle, CircleAlert } from 'lucide-react'
import { UiButton, UI_COLOR_ACCENT_FILL_TEXT_CLASS } from '@/components/ui'
import type { EmbeddedAgentMessage } from '@/core/assistant/embeddedAgent'
import { AssistantMarkdown } from '../conversation/AssistantMarkdown'
import { AssistantMessageAttachments } from '../conversation/AssistantMessageAttachments'

export function EmbeddedUserMessage({ message }: { message: Pick<EmbeddedAgentMessage, 'text' | 'attachments'> }): JSX.Element {
  return <div className="flex min-w-0 justify-end" data-embedded-user-message>
    <div className={`max-w-[90%] rounded-2xl px-4 py-3 ${UI_COLOR_ACCENT_FILL_TEXT_CLASS} text-white`}>
      <p className="whitespace-pre-wrap break-words text-sm leading-6 [overflow-wrap:anywhere]">{message.text}</p>
      {message.attachments?.length ? <AssistantMessageAttachments attachments={message.attachments} /> : null}
    </div>
  </div>
}

function AssistantTurn({ messages, onToggle }: { messages: EmbeddedAgentMessage[]; onToggle(): void }): JSX.Element {
  const hasAnswer = messages.some(message => message.kind === 'answer' || !message.kind)
  const [expanded, setExpanded] = useState(!hasAnswer)
  useEffect(() => { setExpanded(!hasAnswer) }, [hasAnswer])
  const process = messages.filter(message => message.kind === 'process' || message.kind === 'tool')
  const answers = messages.filter(message => message.kind === 'answer' || !message.kind)
  return <div className="min-w-0 space-y-4" data-embedded-assistant-turn>
    {process.length ? <div>
      <UiButton variant="plain" size="sm" className="!px-0 text-text-muted" aria-expanded={expanded}
        onClick={() => { onToggle(); setExpanded(value => !value) }}>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {hasAnswer ? '查看过程' : '处理过程'}
      </UiButton>
      {expanded ? <div className="space-y-3 pt-2 text-text-muted" data-embedded-process>
        {process.map(message => message.kind === 'tool'
          ? <div key={message.id} className="flex items-center gap-2 text-xs">
            {message.status === 'failed' ? <CircleAlert size={14} /> : message.status === 'completed' ? <Check size={14} /> : <LoaderCircle size={14} className="motion-safe:animate-spin" />}
            <span>{message.text}{message.status === 'failed' ? ' · 未完成' : ''}</span>
          </div>
          : <AssistantMarkdown key={message.id} compact>{message.text}</AssistantMarkdown>)}
      </div> : null}
    </div> : null}
    {answers.map(message => <div key={message.id} data-embedded-answer><AssistantMarkdown>{message.text}</AssistantMarkdown></div>)}
  </div>
}

export function EmbeddedTranscript({ messages, onToggle }: { messages: EmbeddedAgentMessage[]; onToggle(): void }): JSX.Element {
  const groups: Array<{ id: string; user?: EmbeddedAgentMessage; replies: EmbeddedAgentMessage[] }> = []
  for (const message of messages) {
    if (message.role === 'user') groups.push({ id: message.id, user: message, replies: [] })
    else {
      if (!groups.length) groups.push({ id: message.id, replies: [] })
      groups[groups.length - 1].replies.push(message)
    }
  }
  return <>{groups.map(group => <div key={group.id} className="space-y-5">
    {group.user ? <EmbeddedUserMessage message={group.user} /> : null}
    {group.replies.length ? <AssistantTurn messages={group.replies} onToggle={onToggle} /> : null}
  </div>)}</>
}
