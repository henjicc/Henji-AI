import {
  AlertCircle,
  Ban,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  CircleDot,
  ClipboardCheck,
  ListChecks,
  LoaderCircle,
} from 'lucide-react'
import type { CSSProperties } from 'react'

import { UI_TEXT_META_CLASS } from '@/components/ui'
import type { AgentRunStatus } from '@/core/assistant/events'

import type {
  AgentExecutionFacetPresentation,
  AgentExecutionPresentation,
} from './agentRunReducer'

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
  if (runStatus === 'waiting_external') return '等待结果'
  if (runStatus === 'paused') return '已暂停'
  if (runStatus === 'cancelled') return '已取消'
  if (runStatus === 'failed') return '受阻'
  if (runStatus === 'completed_with_warning') return '已完成，有提示'
  if (presentation.summary && presentation.summary.recovery.mode !== 'none') return '恢复中'
  if (presentation.verification?.passed) return '已验证'
  if (presentation.verification && !presentation.verification.passed) return '待验证'
  if (runStatus === 'completed') return '已结束'
  return '执行中'
}

const FACET_STATUS_LABELS: Record<AgentExecutionFacetPresentation['status'], string> = {
  pending: '待执行',
  active: '进行中',
  completed: '已完成',
  blocked: '受阻',
  waiting_user: '待补充',
  skipped: '已跳过',
  // 路由把领域判错、助手换了正确的步骤来做。对用户不是失败，只是"这一条不作数了"。
  superseded: '已替换',
}

function FacetStatusIcon({ status }: { status: AgentExecutionFacetPresentation['status'] }): JSX.Element {
  if (status === 'completed') return <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-success" />
  if (status === 'active') return <LoaderCircle className="mt-0.5 h-3 w-3 shrink-0 animate-spin text-accent" />
  if (status === 'waiting_user') return <CircleHelp className="mt-0.5 h-3 w-3 shrink-0 text-warning" />
  if (status === 'blocked') return <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-danger" />
  if (status === 'skipped' || status === 'superseded') {
    return <Ban className="mt-0.5 h-3 w-3 shrink-0 text-text-muted" />
  }
  return <CircleDot className="mt-0.5 h-3 w-3 shrink-0 text-text-muted" />
}

export function ExecutionPlanCard({
  presentation,
  runStatus,
}: ExecutionPlanCardProps): JSX.Element {
  const {
    summary,
    facets,
    artifactRefs,
    verification,
    clarification,
    lastCompaction,
    nextAction,
  } = presentation
  const completedSteps = summary?.completedSteps.slice(-5) ?? []
  const failedSteps = summary?.failedSteps.slice(-3) ?? []
  const evidence = summary?.evidence.slice(-4) ?? []
  const hasDetails = Boolean(
    summary?.route
    || summary?.activeStep
    || completedSteps.length
    || failedSteps.length
    || evidence.length
    || facets.length
    || artifactRefs.length
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

          {facets.length > 0 ? (
            <div className="mt-2 space-y-1" aria-label="子目标状态">
              {facets.map((facet) => (
                <div key={facet.facetId} className="flex min-w-0 items-start gap-1.5">
                  <FacetStatusIcon status={facet.status} />
                  <span className="shrink-0 font-medium text-text-dark">{FACET_STATUS_LABELS[facet.status]}</span>
                  <div className="min-w-0">
                    <div className="break-words">{facet.goal}</div>
                    {facet.reason ? <div className="break-words text-text-muted">{facet.reason}</div> : null}
                    {facet.evidence.length > 0 ? (
                      <div className="break-words text-text-muted">证据：{facet.evidence.slice(-2).join('；')}</div>
                    ) : null}
                  </div>
                </div>
              ))}
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
                    {Object.keys(item.references).length > 0
                      ? `（关联结果：${Object.values(item.references).join('、')}）`
                      : ''}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {artifactRefs.length > 0 ? (
            <div className="mt-2">
              <div className="font-medium text-text-dark">大型证据</div>
              <ul className="mt-1 space-y-0.5">
                {artifactRefs.slice(-4).map((artifactRef) => (
                  <li key={artifactRef} className="break-words">{artifactRef}</li>
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
