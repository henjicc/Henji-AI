import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  ClipboardCheck,
  ListChecks,
} from 'lucide-react'
import type { CSSProperties } from 'react'

import { UI_TEXT_META_CLASS } from '@/components/ui'
import type { AgentRunStatus } from '@/core/assistant/events'

import type { AgentExecutionPresentation } from './agentRunReducer'

const deferredBlockStyle: CSSProperties = {
  contentVisibility: 'auto',
  containIntrinsicSize: 'auto 44px',
  contain: 'layout paint style',
}

interface ExecutionPlanCardProps {
  presentation: AgentExecutionPresentation
  runStatus: AgentRunStatus
}

function planStatusLabel(
  presentation: AgentExecutionPresentation,
  runStatus: AgentRunStatus
): string {
  if (presentation.clarification) return '待补充'
  if (runStatus === 'waiting_approval') return '待批准'
  if (presentation.summary && presentation.summary.recovery.mode !== 'none') return '恢复中'
  if (presentation.verification?.passed) return '已验证'
  if (presentation.verification && !presentation.verification.passed) return '待验证'
  if (['failed', 'cancelled'].includes(runStatus)) return '未完成'
  if (runStatus === 'completed') return '已结束'
  return '执行中'
}

export function ExecutionPlanCard({
  presentation,
  runStatus,
}: ExecutionPlanCardProps): JSX.Element {
  const { summary, verification, clarification, lastCompaction, nextAction } = presentation
  const completedSteps = summary?.completedSteps.slice(-5) ?? []
  const failedSteps = summary?.failedSteps.slice(-3) ?? []
  const evidence = summary?.evidence.slice(-4) ?? []
  const hasDetails = Boolean(
    summary?.route
    || summary?.activeStep
    || completedSteps.length
    || failedSteps.length
    || evidence.length
    || verification
    || clarification
    || lastCompaction
  )

  return (
    <details style={deferredBlockStyle} className="group min-w-0 max-w-full overflow-hidden px-1 py-0.5">
      <summary className="flex min-h-7 min-w-0 cursor-pointer list-none items-center gap-2">
        <ListChecks className="h-3.5 w-3.5 shrink-0 text-accent" />
        <span className={`shrink-0 font-medium ${UI_TEXT_META_CLASS}`}>执行计划</span>
        <span className={`min-w-0 flex-1 truncate ${UI_TEXT_META_CLASS}`}>{nextAction}</span>
        <span className={`shrink-0 ${UI_TEXT_META_CLASS}`}>
          {planStatusLabel(presentation, runStatus)}
        </span>
        {hasDetails ? <ChevronRight className="h-3 w-3 shrink-0 text-text-muted transition-transform group-open:rotate-90" /> : null}
      </summary>

      {hasDetails ? (
        <div className={`min-w-0 border-t border-border-dark/70 pb-1 pl-5 pr-1 pt-2 [overflow-wrap:anywhere] leading-4 ${UI_TEXT_META_CLASS}`}>
          {summary?.route ? (
            <div>
              <span className="font-medium text-text-dark">目标判断：</span>
              {summary.route.summary}
            </div>
          ) : null}

          <div className="mt-2 space-y-1">
            {completedSteps.map((step) => (
              <div key={step.stepId} className="flex min-w-0 items-start gap-1.5">
                <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-success" />
                <span className="shrink-0 text-text-dark">已执行</span>
                <span className="min-w-0 break-words">{step.title}{step.summary ? `：${step.summary}` : ''}</span>
              </div>
            ))}
            {failedSteps.map((step) => (
              <div key={step.stepId} className="flex min-w-0 items-start gap-1.5">
                <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-danger" />
                <span className="shrink-0 text-danger">未完成</span>
                <span className="min-w-0 break-words">{step.title}{step.summary ? `：${step.summary}` : ''}</span>
              </div>
            ))}
            {summary?.activeStep ? (
              <div className="flex min-w-0 items-start gap-1.5">
                <CircleDot className="mt-0.5 h-3 w-3 shrink-0 text-accent" />
                <span className="shrink-0 text-accent">当前</span>
                <span className="min-w-0 break-words">{summary.activeStep.title}</span>
              </div>
            ) : null}
          </div>

          {verification ? (
            <div className="mt-2 flex items-start gap-1.5">
              <ClipboardCheck className={`mt-0.5 h-3 w-3 shrink-0 ${verification.passed ? 'text-success' : 'text-warning'}`} />
              <div className="min-w-0">
                <span className="font-medium text-text-dark">{verification.passed ? '验证通过：' : '验证未通过：'}</span>
                <span className="break-words">{verification.summary}</span>
              </div>
            </div>
          ) : null}

          {evidence.length > 0 ? (
            <div className="mt-2">
              <div className="font-medium text-text-dark">最近证据</div>
              <ul className="mt-1 space-y-0.5">
                {evidence.map((item) => (
                  <li key={`${item.source}-${item.observedAt}`} className="break-words">
                    {item.summary}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {summary?.unresolvedItems.length ? (
            <div className="mt-2">
              <span className="font-medium text-text-dark">仍需处理：</span>
              {summary.unresolvedItems.slice(-3).join('；')}
            </div>
          ) : null}

          <div className="mt-2">
            <span className="font-medium text-text-dark">下一步：</span>{nextAction}
          </div>
          {lastCompaction ? (
            <div className={`mt-1 ${UI_TEXT_META_CLASS}`}>
              上下文已整理：{lastCompaction.beforeTokens.toLocaleString()} → {lastCompaction.afterTokens.toLocaleString()} token
            </div>
          ) : null}
        </div>
      ) : null}
    </details>
  )
}
