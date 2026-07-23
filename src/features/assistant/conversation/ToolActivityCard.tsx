import { CheckCircle2, ChevronDown, ExternalLink, LoaderCircle, Wrench, XCircle } from 'lucide-react'
import type { CSSProperties } from 'react'
import { useState } from 'react'

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
  list_canvas_projects: '列出画布项目',
  open_canvas_project: '打开画布项目',
  search_canvas_node_types: '搜索画布节点类型',
  get_canvas_node_schema: '读取画布节点结构',
  add_canvas_node: '添加画布节点',
  connect_canvas_nodes: '连接画布节点',
  focus_canvas_node: '定位画布节点',
  undo_canvas_change: '撤销画布操作',
}

const statusLabels: Record<AgentToolActivity['status'], string> = {
  requested: '已请求',
  running: '执行中',
  completed: '已完成',
  failed: '失败',
}

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

export function ToolActivityCard({ activity, onOpenTask, onOpenNode }: ToolActivityCardProps): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const taskId = activity.resultReferences?.taskId
  const projectId = activity.resultReferences?.projectId
  const nodeId = activity.resultReferences?.nodeId
  const hasDetails = Boolean(activity.summary || activity.error || activity.artifactRef)
  const icon = activity.status === 'completed'
    ? <CheckCircle2 className="h-4 w-4 text-success" />
    : activity.status === 'failed'
      ? <XCircle className="h-4 w-4 text-danger" />
      : activity.status === 'running'
        ? <LoaderCircle className="h-4 w-4 animate-spin text-accent" />
        : <Wrench className="h-4 w-4 text-text-muted" />

  return (
    <section style={deferredCardStyle} className="rounded-lg bg-surface-dark/80 px-2 py-1.5">
      <div className="flex min-h-6 items-center gap-2">
        {icon}
        <div className="min-w-0 flex-1 truncate text-xs font-medium text-text-dark">
          {toolLabels[activity.toolName] ?? activity.toolName}
        </div>
        <span className="text-[10px] tracking-wide text-text-muted">{statusLabels[activity.status]}</span>
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
              {activity.error.code} · {activity.error.message}
            </div>
          ) : null}
          {activity.artifactRef ? <div className="mt-1 truncate text-[10px] text-text-muted">内部结果引用：{activity.artifactRef}</div> : null}
        </div>
      ) : null}
    </section>
  )
}
