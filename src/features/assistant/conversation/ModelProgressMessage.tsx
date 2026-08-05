import { memo, type CSSProperties } from 'react'
import { Brain, ChevronRight } from 'lucide-react'

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
  const reasoning = update.reasoning.trim()
  const text = update.text.trim()
  return (
    <section style={progressMessageStyle} className="min-w-0 max-w-full overflow-hidden px-1 py-1">
      <div className={`font-medium ${UI_TEXT_META_CLASS}`}>
        {update.stepId === 'attachment-observer' ? '观察模型已读取附件' : '助手进展'}
      </div>
      {reasoning ? (
        // 思考过程是过程不是结论：默认折叠、字重更轻，不与正文抢注意力。
        <details className="group/reasoning mt-0.5 min-w-0">
          <summary className={`flex min-h-6 cursor-pointer list-none items-center gap-1.5 ${UI_TEXT_META_CLASS}`}>
            <Brain className="h-3 w-3 shrink-0 text-text-muted" />
            <span className="shrink-0">思考过程</span>
            {text ? null : (
              <span className="min-w-0 flex-1 truncate text-text-muted">{reasoning.slice(-80)}</span>
            )}
            <ChevronRight className="h-3 w-3 shrink-0 text-text-muted transition-transform group-open/reasoning:rotate-90" />
          </summary>
          <div className="mt-1 border-l border-border-dark/60 pl-2 text-text-muted">
            <AssistantMarkdown compact>{reasoning}</AssistantMarkdown>
          </div>
        </details>
      ) : null}
      {text ? <AssistantMarkdown compact>{text}</AssistantMarkdown> : null}
    </section>
  )
}

export const ModelProgressMessage = memo(ModelProgressMessageView)
