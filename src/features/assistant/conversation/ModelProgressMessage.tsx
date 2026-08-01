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
    <section style={progressMessageStyle} className="min-w-0 max-w-full overflow-hidden px-1 py-1">
      <div className={`font-medium ${UI_TEXT_META_CLASS}`}>
        {update.stepId === 'attachment-observer' ? '观察模型已读取附件' : '助手进展'}
      </div>
      <AssistantMarkdown compact>{update.text}</AssistantMarkdown>
    </section>
  )
}

export const ModelProgressMessage = memo(ModelProgressMessageView)
