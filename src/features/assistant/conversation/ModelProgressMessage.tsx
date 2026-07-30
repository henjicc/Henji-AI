import { Bot } from 'lucide-react'
import { memo, type CSSProperties } from 'react'

import { UI_TEXT_META_CLASS } from '@/components/ui'

import type { AgentModelPublicUpdate } from './agentRunReducer'
import { AssistantMarkdown } from './AssistantMarkdown'

const progressMessageStyle: CSSProperties = {
  contentVisibility: 'auto',
  containIntrinsicSize: 'auto 42px',
  contain: 'layout paint style',
}

interface ModelProgressMessageProps {
  update: AgentModelPublicUpdate
}

function ModelProgressMessageView({ update }: ModelProgressMessageProps): JSX.Element {
  return (
    <section style={progressMessageStyle} className="flex items-start gap-2 px-1 py-1">
      <Bot className="mt-1 h-3.5 w-3.5 shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <div className={`font-medium ${UI_TEXT_META_CLASS}`}>助手进展</div>
        <AssistantMarkdown compact>{update.text}</AssistantMarkdown>
      </div>
    </section>
  )
}

export const ModelProgressMessage = memo(ModelProgressMessageView)
