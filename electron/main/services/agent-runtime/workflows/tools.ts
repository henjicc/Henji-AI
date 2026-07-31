import {
  cancelWorkflowCapability,
  executeWorkflowCapability,
  getWorkflowRunCapability,
  listWorkflowsCapability,
  pauseWorkflowCapability,
  planWorkflowCapability,
  resumeWorkflowCapability,
  rollbackWorkflowCapability,
} from '../../../../../src/core/assistant/capabilities/workflowApplicationCapabilities'
import type { HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import { createBackendCapabilityTool } from '../tools/backend-capability-tool'
import type { AgentToolGateway } from '../tools/gateway'
import type { AgentToolDefinition } from '../tools/types'
import { DeterministicWorkflowService } from './service'

export interface WorkflowToolDependencies {
  service: DeterministicWorkflowService
  gateway: AgentToolGateway
  getHostContext: (runId: string) => HostContextSnapshot | null
}

function workflowPlanSummary(preview: Record<string, unknown>): string {
  const steps = Array.isArray(preview.steps)
    ? preview.steps.flatMap((step) => {
      if (!step || typeof step !== 'object') return []
      const value = step as Record<string, unknown>
      const title = typeof value.title === 'string' ? value.title : '未命名步骤'
      return [title]
    })
    : []
  return steps.length > 0
    ? `将按顺序执行：${steps.join(' → ')}`.slice(0, 2_000)
    : '将执行已经校验的固定流程。'
}

export function createWorkflowTools(
  dependencies: WorkflowToolDependencies
): AgentToolDefinition[] {
  const executionContext = (
    context: Parameters<AgentToolDefinition['execute']>[1]
  ) => ({
    runId: context.runId,
    threadId: context.threadId,
    toolCallId: context.toolCallId,
    signal: context.signal,
    gateway: dependencies.gateway,
    getHostContext: dependencies.getHostContext,
  })

  return [
    createBackendCapabilityTool(listWorkflowsCapability, {
      execute: async () => ({ workflows: dependencies.service.list() }),
    }),
    createBackendCapabilityTool(planWorkflowCapability, {
      execute: async (input, context) => dependencies.service.plan(
        input.workflowId,
        input.params,
        dependencies.getHostContext(context.runId)
      ),
    }),
    createBackendCapabilityTool(executeWorkflowCapability, {
      preview: (input) => {
        const preview = dependencies.service.preview(input.planRef)
        return {
          title: '执行跨工作区流程',
          summary: workflowPlanSummary(preview),
          targetIds: { planRef: input.planRef },
          reversible: Boolean(preview.reversible),
          dataClasses: ['C1'],
        }
      },
      execute: async (input, context) => dependencies.service.execute(
        input.planRef,
        executionContext(context)
      ),
    }),
    createBackendCapabilityTool(getWorkflowRunCapability, {
      execute: async (input) => dependencies.service.get(input.workflowRunRef),
    }),
    createBackendCapabilityTool(pauseWorkflowCapability, {
      execute: async (input) => dependencies.service.pause(input.workflowRunRef),
    }),
    createBackendCapabilityTool(resumeWorkflowCapability, {
      execute: async (input, context) => dependencies.service.resume(
        input.workflowRunRef,
        executionContext(context)
      ),
    }),
    createBackendCapabilityTool(cancelWorkflowCapability, {
      execute: async (input) => dependencies.service.cancel(input.workflowRunRef),
    }),
    createBackendCapabilityTool(rollbackWorkflowCapability, {
      execute: async (input, context) => dependencies.service.rollback(
        input.workflowRunRef,
        executionContext(context)
      ),
    }),
  ] as AgentToolDefinition[]
}
