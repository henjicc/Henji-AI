import { CheckCircle2, ChevronDown, ExternalLink, LoaderCircle, SearchCheck, Send, Wrench, XCircle } from 'lucide-react'
import { memo, useState, type CSSProperties } from 'react'

import { UI_TEXT_LABEL_CLASS, UI_TEXT_META_CLASS, UiButton, UiIconButton } from '@/components/ui'

import type { AgentToolActivity } from './agentRunReducer'
import { describeStructuredError } from './errorPresentation'

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
  const hasDetails = Boolean(
    activity.summary
    || activity.error
    || activity.artifactRef
    || Object.keys(activity.resultReferences ?? {}).length > 0
  )
  const errorPresentation = activity.error ? describeStructuredError(activity.error) : null
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
    <section style={deferredCardStyle} className="min-w-0 max-w-full overflow-hidden px-1 py-0.5">
      <div className="flex min-h-6 min-w-0 items-center gap-2">
        {icon}
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className={`min-w-0 max-w-[45%] truncate ${UI_TEXT_LABEL_CLASS}`}>{activity.title}</span>
          {activity.summary ? <span className={`min-w-0 flex-1 truncate ${UI_TEXT_META_CLASS}`}>{activity.summary}</span> : null}
        </div>
        <span className={`shrink-0 tracking-wide ${UI_TEXT_META_CLASS}`}>{statusLabel}</span>
        {taskId ? (
          <UiButton type="button" size="sm" variant="ghost" onClick={() => onOpenTask(taskId)} className="!h-6 gap-1 !px-1.5 text-3xs">
            <ExternalLink className="h-3 w-3" />查看
          </UiButton>
        ) : null}
        {projectId && nodeId ? (
          <UiButton type="button" size="sm" variant="ghost" onClick={() => onOpenNode(projectId, nodeId)} className="!h-6 gap-1 !px-1.5 text-3xs">
            <ExternalLink className="h-3 w-3" />定位
          </UiButton>
        ) : null}
        {hasDetails ? (
          <UiIconButton
            type="button"
            showBorder={false}
            appearance="hover-only"
            title={expanded ? '收起详情' : '展开详情'}
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            className="!h-6 !w-6 !rounded-lg"
          >
            <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
          </UiIconButton>
        ) : null}
      </div>
      {hasDetails ? (
        <div
          className={`grid transition-[grid-template-rows,opacity] duration-200 ${
            expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
          }`}
        >
          <div
            aria-hidden={!expanded}
            className={`min-h-0 overflow-hidden ${expanded ? '' : 'pointer-events-none select-none'}`}
          >
            <div className={`min-w-0 pb-1 pl-6 pt-1 [overflow-wrap:anywhere] transition-transform duration-200 ${
              expanded ? 'translate-y-0' : '-translate-y-1'
            }`}>
              {activity.summary ? <p className={`break-words leading-4 ${UI_TEXT_META_CLASS}`}>{activity.summary}</p> : null}
              {errorPresentation ? (
                <div className="mt-1 rounded-md bg-danger/10 p-1.5 text-2xs leading-4 text-danger">
                  <div className="font-medium">{errorPresentation.title}</div>
                  <div className="mt-1 break-words text-text-muted [overflow-wrap:anywhere]">{activity.error?.message}</div>
                  <div className="mt-1 text-text-muted">下一步：{errorPresentation.nextAction}</div>
                </div>
              ) : null}
              {Object.keys(activity.resultReferences ?? {}).length > 0 ? (
                <div className={`mt-1 break-words ${UI_TEXT_META_CLASS}`}>
                  关联结果：{Object.values(activity.resultReferences ?? {}).join('、')}
                </div>
              ) : null}
              {activity.artifactRef ? (
                <div className={`mt-1 break-words ${UI_TEXT_META_CLASS}`}>
                  大型结果：{activity.artifactRef}
                </div>
              ) : null}
            </div>
          </div>
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
