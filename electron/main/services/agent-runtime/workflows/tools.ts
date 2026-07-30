import { z } from 'zod'

import type { HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import type { AgentToolGateway } from '../tools/gateway'
import type { AgentToolDefinition } from '../tools/types'
import { DeterministicWorkflowService } from './service'
import { workflowIdSchema } from './definitions'

const workflowResultSchema = z.object({
  workflowRunRef: z.string().optional(),
  planRef: z.string().optional(),
  workflowId: z.string().optional(),
  status: z.string().optional(),
}).passthrough()

export interface WorkflowToolDependencies {
  service: DeterministicWorkflowService
  gateway: AgentToolGateway
  getHostContext: (runId: string) => HostContextSnapshot | null
}

function workflowTool<TInput>(definition: AgentToolDefinition<TInput, Record<string, unknown>>): AgentToolDefinition {
  return definition as unknown as AgentToolDefinition
}

function workflowPlanSummary(preview: Record<string, unknown>): string {
  const steps = Array.isArray(preview.steps)
    ? preview.steps.flatMap((step) => {
      if (!step || typeof step !== 'object') return []
      const value = step as Record<string, unknown>
      const title = typeof value.title === 'string' ? value.title : '未命名步骤'
      const toolName = typeof value.toolName === 'string' ? value.toolName : 'unknown_tool'
      return [`${title}（${toolName}）`]
    })
    : []
  const details = steps.length > 0 ? `：${steps.join(' → ')}` : '。'
  return `将按固定顺序执行 ${String(preview.stepCount)} 个步骤${details}`.slice(0, 2_000)
}

export function createWorkflowTools(dependencies: WorkflowToolDependencies): AgentToolDefinition[] {
  const list = workflowTool({
    name: 'list_workflows', version: 1, title: '列出确定性工作流',
    description: '列出由代码固定步骤、审批点、revision 检查和补偿边界的跨工作区工作流。', category: 'workflows', side: 'backend',
    risk: 'R0', permission: 'workflow:read', readOnly: true, destructive: false, openWorld: false, idempotent: true,
    timeoutMs: 5_000, retryPolicy: { maxRetries: 1, baseDelayMs: 100 }, supportsPreview: false, supportsUndo: false, requiredContext: [],
    inputSchema: z.object({}).strict(), outputSchema: z.object({ workflows: z.array(z.record(z.string(), z.unknown())) }).strict(),
    aiInputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => ({ workflows: dependencies.service.list() }), concurrencyKey: () => 'workflow_catalog', targetIds: () => ({}), dataClasses: () => ['C0'], summarize: (output) => `已列出 ${Array.isArray(output.workflows) ? output.workflows.length : 0} 个确定性工作流。`,
  })
  const plan = workflowTool({
    name: 'plan_workflow', version: 1, title: '规划跨工作区工作流',
    description: '根据稳定工作流 ID 和语义参数生成计划；只创建计划，不执行领域操作。', category: 'workflows', side: 'backend',
    risk: 'R1', permission: 'workflow:plan', readOnly: true, destructive: false, openWorld: false, idempotent: false,
    timeoutMs: 8_000, retryPolicy: { maxRetries: 0, baseDelayMs: 0 }, supportsPreview: false, supportsUndo: false, requiredContext: [],
    inputSchema: z.object({ workflowId: workflowIdSchema, params: z.record(z.string(), z.unknown()) }).strict(), outputSchema: z.record(z.string(), z.unknown()),
    aiInputSchema: { type: 'object', properties: { workflowId: { type: 'string', enum: workflowIdSchema.options }, params: { type: 'object', additionalProperties: true } }, required: ['workflowId', 'params'], additionalProperties: false },
    execute: async (input, context) => dependencies.service.plan(input.workflowId, input.params, dependencies.getHostContext(context.runId)), concurrencyKey: (input) => `workflow_plan:${input.workflowId}`, targetIds: (input) => ({ workflowId: input.workflowId }), dataClasses: () => ['C1'], summarize: (output) => `已生成工作流计划 ${String(output.planRef)}，包含 ${String(output.stepCount)} 个步骤。`,
  })
  const execute = workflowTool({
    name: 'execute_workflow', version: 1, title: '执行跨工作区工作流',
    description: '执行已经规划的跨工作区工作流。步骤顺序由代码固定，执行前由网关统一审批，失败时按声明的补偿动作恢复。', category: 'workflows', side: 'backend',
    risk: 'R2', permission: 'workflow:execute', readOnly: false, destructive: true, openWorld: true, idempotent: false, maxCallsPerRun: 3,
    timeoutMs: 120_000, retryPolicy: { maxRetries: 0, baseDelayMs: 0 }, supportsPreview: true, supportsUndo: true, requiredContext: [],
    inputSchema: z.object({ planRef: z.string().min(1) }).strict(), outputSchema: workflowResultSchema,
    aiInputSchema: { type: 'object', properties: { planRef: { type: 'string' } }, required: ['planRef'], additionalProperties: false },
    preview: (input) => { const preview = dependencies.service.preview(input.planRef); return { title: '执行跨工作区工作流', summary: workflowPlanSummary(preview), targetIds: { planRef: input.planRef }, reversible: Boolean(preview.reversible), dataClasses: ['C1'] } },
    execute: async (input, context) => dependencies.service.execute(input.planRef, { runId: context.runId, threadId: context.threadId, toolCallId: context.toolCallId, signal: context.signal, gateway: dependencies.gateway, getHostContext: dependencies.getHostContext }), concurrencyKey: (input) => `workflow_execute:${input.planRef}`, targetIds: (input) => ({ planRef: input.planRef }), dataClasses: () => ['C1'], summarize: (output) => `工作流 ${String(output.workflowId ?? '')} 当前状态：${String(output.status ?? 'unknown')}。`, undo: (output) => typeof output.workflowRunRef === 'string' ? { kind: 'workflow', token: output.workflowRunRef } : undefined,
  })
  const get = workflowTool({
    name: 'get_workflow_run', version: 1, title: '读取工作流状态', description: '读取工作流步骤完成、补偿、revision 和错误摘要。', category: 'workflows', side: 'backend',
    risk: 'R0', permission: 'workflow:read', readOnly: true, destructive: false, openWorld: false, idempotent: true, timeoutMs: 5_000, retryPolicy: { maxRetries: 1, baseDelayMs: 100 }, supportsPreview: false, supportsUndo: false, requiredContext: [],
    inputSchema: z.object({ workflowRunRef: z.string().min(1) }).strict(), outputSchema: workflowResultSchema, aiInputSchema: { type: 'object', properties: { workflowRunRef: { type: 'string' } }, required: ['workflowRunRef'], additionalProperties: false }, execute: async (input) => dependencies.service.get(input.workflowRunRef), concurrencyKey: (input) => `workflow_run:${input.workflowRunRef}`, targetIds: (input) => ({ workflowRunRef: input.workflowRunRef }), dataClasses: () => ['C1'], summarize: (output) => `工作流状态：${String(output.status ?? 'unknown')}。`,
  })
  const pause = workflowTool({
    name: 'pause_workflow', version: 1, title: '暂停工作流', description: '请求工作流在当前步骤完成后暂停；不会强行中断未知副作用。', category: 'workflows', side: 'backend', risk: 'R1', permission: 'workflow:control', readOnly: false, destructive: false, openWorld: false, idempotent: true, timeoutMs: 5_000, retryPolicy: { maxRetries: 0, baseDelayMs: 0 }, supportsPreview: false, supportsUndo: false, requiredContext: [], inputSchema: z.object({ workflowRunRef: z.string().min(1) }).strict(), outputSchema: workflowResultSchema, aiInputSchema: { type: 'object', properties: { workflowRunRef: { type: 'string' } }, required: ['workflowRunRef'], additionalProperties: false }, execute: async (input) => dependencies.service.pause(input.workflowRunRef), concurrencyKey: (input) => `workflow_control:${input.workflowRunRef}`, targetIds: (input) => ({ workflowRunRef: input.workflowRunRef }), dataClasses: () => ['C1'], summarize: () => '已请求暂停工作流。',
  })
  const resume = workflowTool({
    name: 'resume_workflow', version: 1, title: '恢复工作流', description: '从安全检查点继续未完成的工作流步骤。', category: 'workflows', side: 'backend', risk: 'R2', permission: 'workflow:execute', readOnly: false, destructive: true, openWorld: true, idempotent: false, timeoutMs: 120_000, retryPolicy: { maxRetries: 0, baseDelayMs: 0 }, supportsPreview: true, supportsUndo: true, requiredContext: [], inputSchema: z.object({ workflowRunRef: z.string().min(1) }).strict(), outputSchema: workflowResultSchema, aiInputSchema: { type: 'object', properties: { workflowRunRef: { type: 'string' } }, required: ['workflowRunRef'], additionalProperties: false }, preview: (input) => ({ title: '恢复工作流', summary: `从工作流 ${input.workflowRunRef} 的安全检查点继续。`, targetIds: { workflowRunRef: input.workflowRunRef }, reversible: true, dataClasses: ['C1'] }), execute: async (input, context) => dependencies.service.resume(input.workflowRunRef, { runId: context.runId, threadId: context.threadId, toolCallId: context.toolCallId, signal: context.signal, gateway: dependencies.gateway, getHostContext: dependencies.getHostContext }), concurrencyKey: (input) => `workflow_execute:${input.workflowRunRef}`, targetIds: (input) => ({ workflowRunRef: input.workflowRunRef }), dataClasses: () => ['C1'], summarize: (output) => `工作流恢复后状态：${String(output.status ?? 'unknown')}。`,
  })
  const cancel = workflowTool({
    name: 'cancel_workflow', version: 1, title: '取消工作流', description: '取消指定工作流并阻止后续步骤；已完成的步骤不会被假装回滚。', category: 'workflows', side: 'backend', risk: 'R1', permission: 'workflow:control', readOnly: false, destructive: true, openWorld: false, idempotent: true, timeoutMs: 5_000, retryPolicy: { maxRetries: 0, baseDelayMs: 0 }, supportsPreview: true, supportsUndo: false, requiredContext: [], inputSchema: z.object({ workflowRunRef: z.string().min(1) }).strict(), outputSchema: workflowResultSchema, aiInputSchema: { type: 'object', properties: { workflowRunRef: { type: 'string' } }, required: ['workflowRunRef'], additionalProperties: false }, preview: (input) => ({ title: '取消工作流', summary: `取消工作流 ${input.workflowRunRef}。`, targetIds: { workflowRunRef: input.workflowRunRef }, reversible: false, dataClasses: ['C1'] }), execute: async (input) => dependencies.service.cancel(input.workflowRunRef), concurrencyKey: (input) => `workflow_control:${input.workflowRunRef}`, targetIds: (input) => ({ workflowRunRef: input.workflowRunRef }), dataClasses: () => ['C1'], summarize: () => '已取消工作流。',
  })
  const rollback = workflowTool({
    name: 'rollback_workflow', version: 1, title: '回滚工作流', description: '按已声明的补偿动作逆序撤销可恢复步骤；不可撤销的 Provider 副作用会保留在结果说明中。', category: 'workflows', side: 'backend', risk: 'R2', permission: 'workflow:rollback', readOnly: false, destructive: true, openWorld: false, idempotent: true, timeoutMs: 60_000, retryPolicy: { maxRetries: 0, baseDelayMs: 0 }, supportsPreview: true, supportsUndo: false, requiredContext: [], inputSchema: z.object({ workflowRunRef: z.string().min(1) }).strict(), outputSchema: workflowResultSchema, aiInputSchema: { type: 'object', properties: { workflowRunRef: { type: 'string' } }, required: ['workflowRunRef'], additionalProperties: false }, preview: (input) => ({ title: '回滚工作流', summary: `按补偿动作回滚工作流 ${input.workflowRunRef}。`, targetIds: { workflowRunRef: input.workflowRunRef }, reversible: false, dataClasses: ['C1'] }), execute: async (input, context) => dependencies.service.rollback(input.workflowRunRef, { runId: context.runId, threadId: context.threadId, toolCallId: context.toolCallId, signal: context.signal, gateway: dependencies.gateway, getHostContext: dependencies.getHostContext }), concurrencyKey: (input) => `workflow_control:${input.workflowRunRef}`, targetIds: (input) => ({ workflowRunRef: input.workflowRunRef }), dataClasses: () => ['C1'], summarize: (output) => `工作流回滚状态：${String(output.status ?? 'unknown')}。`,
  })
  return [list, plan, execute, get, pause, resume, cancel, rollback]
}
