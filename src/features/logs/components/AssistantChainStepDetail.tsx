import { ASSISTANT_CHAIN_STATUS_LABEL as STATUS_LABEL, formatChainDuration, type AssistantChain, type AssistantChainStatus, type AssistantChainStep } from '@/core/assistant/assistantChain'
import { JsonTree } from './JsonTree'

const STATUS_CLASS: Record<AssistantChainStatus, string> = {
  running: 'bg-accent-tint text-accent-text', completed: 'bg-success-tint text-success-text', failed: 'bg-danger-tint text-danger-text', cancelled: 'bg-warning-tint text-warning-text',
}

/** 链路中非模型轮次的一步（输入、上下文、工具、事务、回复）：结构化事实加组成它的原始日志。 */
export function AssistantChainStepDetail({ chain, step }: { chain: AssistantChain; step: AssistantChainStep }): JSX.Element {
  const events = step.eventIndexes.map((index) => chain.events[index]).filter(Boolean)
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg bg-panel">
      <div className="flex shrink-0 items-center gap-2 whitespace-nowrap border-b border-line/40 px-3 py-2">
        <span className="min-w-0 truncate text-sm font-semibold text-text1">{step.title}</span>
        <span className={`shrink-0 rounded-control px-1.5 py-0.5 text-2xs ${STATUS_CLASS[step.status]}`}>{STATUS_LABEL[step.status]}</span>
        <span className="ml-auto shrink-0 font-mono text-2xs text-text2">
          {step.startedAt ? new Date(step.startedAt).toLocaleTimeString('zh-CN') : ''}{step.durationMs !== undefined ? ` · ${formatChainDuration(step.durationMs)}` : ''}
        </span>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-xs text-text1">
        <JsonTree value={step.data} />
        {events.length ? (
          <div className="space-y-1">
            <div className="text-2xs font-medium text-text2">原始日志（{events.length}）</div>
            <JsonTree value={events} />
          </div>
        ) : null}
      </div>
    </div>
  )
}
