import { z } from 'zod'

import type { ApplicationCapabilityDefinition } from '../applicationCapabilities'
import { defineApplicationCapability } from './defineApplicationCapability'

export const workflowIdSchema = z.enum([
  'model_to_generation_canvas',
  'asset_edit_to_canvas',
  'camera_shot_to_generation_canvas',
])

export const workflowResultSchema = z.object({
  workflowRunRef: z.string().optional(),
  planRef: z.string().optional(),
  workflowId: z.string().optional(),
  status: z.string().optional(),
}).passthrough()

export const listWorkflowsCapability = defineApplicationCapability({
  id: 'list_workflows',
  version: 1,
  title: '列出确定性工作流',
  description: '列出可安全执行的跨工作区固定流程。',
  domain: 'workflows',
  aliases: ['有哪些工作流', '跨工作区流程', 'workflow'],
  side: 'backend',
  readOnly: true,
  risk: 'R0',
  dataClasses: ['C0'],
  permission: 'workflow:read',
  idempotent: true,
  destructive: false,
  timeoutMs: 5_000,
  supportsPreview: false,
  supportsUndo: false,
  requiredScopes: [],
  inputSchema: z.object({}).strict(),
  outputSchema: z.object({
    workflows: z.array(z.record(z.string(), z.unknown())),
  }).strict(),
  concurrencyKey: 'workflow:catalog',
  summarize: (output) => `已列出 ${output.workflows.length} 个工作流。`,
})

export const planWorkflowCapability = defineApplicationCapability({
  id: 'plan_workflow',
  version: 1,
  title: '规划跨工作区流程',
  description: '根据固定流程和参数生成待执行计划，不执行实际操作。',
  domain: 'workflows',
  aliases: ['规划工作流', '创建执行计划'],
  side: 'backend',
  readOnly: true,
  risk: 'R1',
  dataClasses: ['C1'],
  permission: 'workflow:plan',
  idempotent: false,
  destructive: false,
  timeoutMs: 8_000,
  supportsPreview: false,
  supportsUndo: false,
  requiredScopes: [],
  inputSchema: z.object({
    workflowId: workflowIdSchema,
    params: z.record(z.string(), z.unknown()),
  }).strict(),
  outputSchema: z.record(z.string(), z.unknown()),
  concurrencyKey: 'workflow:plan',
  resolveConcurrencyKey: (input) => `workflow_plan:${input.workflowId}`,
  resolveTargetIds: (input) => ({ workflowId: input.workflowId }),
  summarize: (output) => `已生成包含 ${String(output.stepCount ?? 0)} 个步骤的工作流计划。`,
})

function controlCapability(
  id: 'get_workflow_run' | 'pause_workflow' | 'cancel_workflow' | 'rollback_workflow',
  title: string,
  description: string,
  options: {
    readOnly: boolean
    risk: 'R0' | 'R1' | 'R2'
    permission: string
    destructive: boolean
    timeoutMs: number
    supportsPreview?: boolean
  }
): ApplicationCapabilityDefinition<{ workflowRunRef: string }, z.infer<typeof workflowResultSchema>> {
  return defineApplicationCapability({
    id,
    version: 1,
    title,
    description,
    domain: 'workflows',
    aliases: [title, '工作流状态', 'workflow'],
    side: 'backend',
    readOnly: options.readOnly,
    risk: options.risk,
    dataClasses: ['C1'],
    permission: options.permission,
    idempotent: true,
    destructive: options.destructive,
    timeoutMs: options.timeoutMs,
    supportsPreview: options.supportsPreview ?? false,
    supportsUndo: false,
    requiredScopes: [],
    inputSchema: z.object({ workflowRunRef: z.string().min(1) }).strict(),
    outputSchema: workflowResultSchema,
    concurrencyKey: 'workflow:control',
    resolveConcurrencyKey: (input) => `workflow_control:${input.workflowRunRef}`,
    resolveTargetIds: (input) => ({ workflowRunRef: input.workflowRunRef }),
    preview: options.supportsPreview
      ? (input) => ({
          title,
          summary: `${title}。`,
          targetIds: { workflowRunRef: input.workflowRunRef },
          reversible: false,
          dataClasses: ['C1'],
        })
      : undefined,
    summarize: (output) => `工作流状态：${String(output.status ?? 'unknown')}。`,
  })
}

export const executeWorkflowCapability = defineApplicationCapability({
  id: 'execute_workflow',
  version: 1,
  title: '执行跨工作区流程',
  description: '执行已经确认的固定工作流计划。',
  domain: 'workflows',
  aliases: ['执行工作流', '运行计划'],
  side: 'backend',
  readOnly: false,
  risk: 'R2',
  dataClasses: ['C1'],
  permission: 'workflow:execute',
  idempotent: false,
  destructive: true,
  openWorld: true,
  timeoutMs: 120_000,
  supportsPreview: true,
  supportsUndo: true,
  requiredScopes: [],
  inputSchema: z.object({ planRef: z.string().min(1) }).strict(),
  outputSchema: workflowResultSchema,
  concurrencyKey: 'workflow:execute',
  resolveConcurrencyKey: (input) => `workflow_execute:${input.planRef}`,
  resolveTargetIds: (input) => ({ planRef: input.planRef }),
  createUndo: (output) => typeof output.workflowRunRef === 'string'
    ? { kind: 'workflow', token: output.workflowRunRef }
    : undefined,
  summarize: (output) => `工作流状态：${String(output.status ?? 'unknown')}。`,
})

export const resumeWorkflowCapability = defineApplicationCapability({
  id: 'resume_workflow',
  version: 1,
  title: '恢复跨工作区流程',
  description: '从安全检查点继续未完成的工作流。',
  domain: 'workflows',
  aliases: ['继续工作流', '恢复流程'],
  side: 'backend',
  readOnly: false,
  risk: 'R2',
  dataClasses: ['C1'],
  permission: 'workflow:execute',
  idempotent: false,
  destructive: true,
  openWorld: true,
  timeoutMs: 120_000,
  supportsPreview: true,
  supportsUndo: true,
  requiredScopes: [],
  inputSchema: z.object({ workflowRunRef: z.string().min(1) }).strict(),
  outputSchema: workflowResultSchema,
  concurrencyKey: 'workflow:execute',
  resolveConcurrencyKey: (input) => `workflow_execute:${input.workflowRunRef}`,
  resolveTargetIds: (input) => ({ workflowRunRef: input.workflowRunRef }),
  createUndo: (output) => typeof output.workflowRunRef === 'string'
    ? { kind: 'workflow', token: output.workflowRunRef }
    : undefined,
  summarize: (output) => `工作流恢复后状态：${String(output.status ?? 'unknown')}。`,
})

export const getWorkflowRunCapability = controlCapability(
  'get_workflow_run',
  '读取工作流状态',
  '读取工作流当前步骤和错误摘要。',
  {
    readOnly: true,
    risk: 'R0',
    permission: 'workflow:read',
    destructive: false,
    timeoutMs: 5_000,
  }
)

export const pauseWorkflowCapability = controlCapability(
  'pause_workflow',
  '暂停工作流',
  '在当前安全步骤完成后暂停工作流。',
  {
    readOnly: false,
    risk: 'R1',
    permission: 'workflow:control',
    destructive: false,
    timeoutMs: 5_000,
  }
)

export const cancelWorkflowCapability = controlCapability(
  'cancel_workflow',
  '取消工作流',
  '取消工作流并阻止后续步骤。',
  {
    readOnly: false,
    risk: 'R1',
    permission: 'workflow:control',
    destructive: true,
    timeoutMs: 5_000,
    supportsPreview: true,
  }
)

export const rollbackWorkflowCapability = controlCapability(
  'rollback_workflow',
  '回滚工作流',
  '按已声明的补偿动作回滚可恢复步骤。',
  {
    readOnly: false,
    risk: 'R2',
    permission: 'workflow:rollback',
    destructive: true,
    timeoutMs: 60_000,
    supportsPreview: true,
  }
)

export const WORKFLOW_APPLICATION_CAPABILITIES: ApplicationCapabilityDefinition[] = [
  listWorkflowsCapability,
  planWorkflowCapability,
  executeWorkflowCapability,
  getWorkflowRunCapability,
  pauseWorkflowCapability,
  resumeWorkflowCapability,
  cancelWorkflowCapability,
  rollbackWorkflowCapability,
]
