import { Bot } from 'lucide-react'
import { memo, type CSSProperties } from 'react'

import { UI_INSET_SURFACE_CLASS, UI_TEXT_META_CLASS } from '@/components/ui'

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
    <section style={progressMessageStyle} className={`mr-7 rounded-lg ${UI_INSET_SURFACE_CLASS} px-2.5 py-2`}>
      <div className={`mb-1 flex items-center gap-1.5 font-medium ${UI_TEXT_META_CLASS}`}>
        <Bot className="h-3.5 w-3.5 text-accent" />助手进展
      </div>
      <AssistantMarkdown>{update.text}</AssistantMarkdown>
    </section>
  )
}

export const ModelProgressMessage = memo(ModelProgressMessageView)
