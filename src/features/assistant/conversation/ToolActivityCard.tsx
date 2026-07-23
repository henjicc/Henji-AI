import { CheckCircle2, ExternalLink, LoaderCircle, Wrench, XCircle } from 'lucide-react'
import type { CSSProperties } from 'react'

import { UiButton } from '@/components/ui'

import type { AgentToolActivity } from './agentRunReducer'

const toolLabels: Record<string, string> = {
  search_application_capabilities: '搜索应用能力',
  switch_workspace: '切换工作区',
  search_models: '搜索模型',
  get_model_schema: '读取模型参数',
  create_visible_generation_task: '创建生成任务',
  get_generation_task: '读取生成任务',
  cancel_generation_task: '取消生成任务',
  query_diagnostic_events: '查询诊断证据',
}

const statusLabels: Record<AgentToolActivity['status'], string> = {
  requested: '已请求',
  running: '执行中',
  completed: '已完成',
  failed: '失败',
}

const deferredCardStyle: CSSProperties = {
  contentVisibility: 'auto',
  containIntrinsicSize: 'auto 84px',
}

interface ToolActivityCardProps {
  activity: AgentToolActivity
  onOpenTask: (taskId: string) => void
}

export function ToolActivityCard({ activity, onOpenTask }: ToolActivityCardProps): JSX.Element {
  const taskId = activity.resultReferences?.taskId
  const icon = activity.status === 'completed'
    ? <CheckCircle2 className="h-4 w-4 text-success" />
    : activity.status === 'failed'
      ? <XCircle className="h-4 w-4 text-danger" />
      : activity.status === 'running'
        ? <LoaderCircle className="h-4 w-4 animate-spin text-accent" />
        : <Wrench className="h-4 w-4 text-text-muted" />

  return (
    <section style={deferredCardStyle} className="rounded-xl border border-border-dark bg-surface-dark p-3">
      <div className="flex items-center gap-2">
        {icon}
        <div className="min-w-0 flex-1 truncate text-xs font-medium text-text-dark">
          {toolLabels[activity.toolName] ?? activity.toolName}
        </div>
        <span className="text-[10px] tracking-wide text-text-muted">{statusLabels[activity.status]}</span>
      </div>
      {activity.summary ? <p className="mt-2 text-xs leading-5 text-text-muted">{activity.summary}</p> : null}
      {activity.error ? (
        <div className="mt-2 rounded-lg border border-danger/30 bg-danger/10 p-2 text-xs text-danger">
          {activity.error.code} · {activity.error.message}
        </div>
      ) : null}
      {activity.artifactRef ? (
        <div className="mt-2 truncate text-[11px] text-text-muted">大结果引用：{activity.artifactRef}</div>
      ) : null}
      {taskId ? (
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-[11px] text-text-muted">任务 {taskId}</span>
          <UiButton type="button" size="sm" variant="ghost" onClick={() => onOpenTask(taskId)} className="h-7 gap-1 px-2">
            <ExternalLink className="h-3 w-3" />查看
          </UiButton>
        </div>
      ) : null}
    </section>
  )
}
