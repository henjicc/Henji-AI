import { CheckCircle2, ChevronDown, ExternalLink, LoaderCircle, SearchCheck, Send, Wrench, XCircle } from 'lucide-react'
import { memo, useState, type CSSProperties } from 'react'

import { UiButton } from '@/components/ui'

import type { AgentToolActivity } from './agentRunReducer'
import { describeErrorRecovery } from './errorPresentation'

const activeStatusLabels: Record<Exclude<AgentToolActivity['status'], 'completed'>, string> = {
  requested: '已请求',
  running: '执行中',
  failed: '未完成',
}

const completionLabels = {
  observed: '已查询',
  submitted: '已提交',
  executed: '已执行',
} as const

const deferredCardStyle: CSSProperties = {
  contentVisibility: 'auto',
  containIntrinsicSize: 'auto 36px',
  contain: 'layout paint style',
}

interface ToolActivityCardProps {
  activity: AgentToolActivity
  onOpenTask: (taskId: string) => void
  onOpenNode: (projectId: string, nodeId: string) => void
}

function ToolActivityCardView({ activity, onOpenTask, onOpenNode }: ToolActivityCardProps): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const taskId = activity.resultReferences?.taskId
  const projectId = activity.resultReferences?.projectId
  const nodeId = activity.resultReferences?.nodeId
  const hasDetails = Boolean(activity.inputDigest || activity.summary || activity.error || activity.artifactRef || activity.resultReferences)
  const statusLabel = activity.status === 'completed'
    ? completionLabels[activity.completionKind ?? (activity.readOnly ? 'observed' : 'executed')]
    : activeStatusLabels[activity.status]
  const icon = activity.status === 'completed'
    ? activity.completionKind === 'submitted'
      ? <Send className="h-4 w-4 text-accent" />
      : activity.completionKind === 'observed' || activity.readOnly
        ? <SearchCheck className="h-4 w-4 text-success" />
        : <CheckCircle2 className="h-4 w-4 text-success" />
    : activity.status === 'failed'
      ? <XCircle className="h-4 w-4 text-danger" />
      : activity.status === 'running'
        ? <LoaderCircle className="h-4 w-4 animate-spin text-accent" />
        : <Wrench className="h-4 w-4 text-text-muted" />

  return (
    <section style={deferredCardStyle} className="rounded-md bg-surface-dark/60 px-2 py-1">
      <div className="flex min-h-6 items-center gap-2">
        {icon}
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="min-w-0 max-w-[45%] truncate text-xs font-medium text-text-dark">{activity.title}</span>
          {activity.summary ? <span className="min-w-0 flex-1 truncate text-[10px] text-text-muted">{activity.summary}</span> : null}
        </div>
        <span className="shrink-0 text-[10px] tracking-wide text-text-muted">{statusLabel}</span>
        {taskId ? (
          <UiButton type="button" size="sm" variant="ghost" onClick={() => onOpenTask(taskId)} className="!h-6 gap-1 !px-1.5 text-[10px]">
            <ExternalLink className="h-3 w-3" />查看
          </UiButton>
        ) : null}
        {projectId && nodeId ? (
          <UiButton type="button" size="sm" variant="ghost" onClick={() => onOpenNode(projectId, nodeId)} className="!h-6 gap-1 !px-1.5 text-[10px]">
            <ExternalLink className="h-3 w-3" />定位
          </UiButton>
        ) : null}
        {hasDetails ? (
          <UiButton
            type="button"
            size="sm"
            variant="ghost"
            title={expanded ? '收起详情' : '展开详情'}
            onClick={() => setExpanded((value) => !value)}
            className="!h-6 !w-6 !p-0"
          >
            <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </UiButton>
        ) : null}
      </div>
      {expanded ? (
        <div className="border-t border-border-dark/70 pb-1 pt-1.5">
          {activity.summary ? <p className="text-[11px] leading-4 text-text-muted">{activity.summary}</p> : null}
          {activity.error ? (
            <div className="mt-1 rounded-md bg-danger/10 p-1.5 text-[11px] leading-4 text-danger">
              <div>{activity.error.message}</div>
              <div className="mt-1 text-text-muted">下一步：{describeErrorRecovery(activity.error)}</div>
              <div className="mt-1 text-[10px] text-text-muted">错误代码：{activity.error.code}</div>
            </div>
          ) : null}
          {activity.resultReferences ? (
            <dl className="mt-1 grid gap-0.5 text-[10px] text-text-muted">
              {Object.entries(activity.resultReferences).map(([key, value]) => (
                <div key={key} className="flex min-w-0 gap-2">
                  <dt className="shrink-0">{key}</dt>
                  <dd className="min-w-0 break-all text-text-dark">{value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {activity.artifactRef ? <div className="mt-1 truncate text-[10px] text-text-muted">内部结果引用：{activity.artifactRef}</div> : null}
        </div>
      ) : null}
    </section>
  )
}

function sameActivity(left: AgentToolActivity, right: AgentToolActivity): boolean {
  return left.toolCallId === right.toolCallId
    && left.title === right.title
    && left.status === right.status
    && left.summary === right.summary
    && left.error === right.error
    && left.artifactRef === right.artifactRef
    && left.resultReferences === right.resultReferences
    && left.completionKind === right.completionKind
    && left.readOnly === right.readOnly
    && left.inputDigest === right.inputDigest
}

export const ToolActivityCard = memo(ToolActivityCardView, (previous, next) => (
  sameActivity(previous.activity, next.activity)
  && previous.onOpenTask === next.onOpenTask
  && previous.onOpenNode === next.onOpenNode
))
