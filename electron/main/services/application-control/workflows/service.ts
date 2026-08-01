import { randomUUID } from 'node:crypto'

import type { HostContextSnapshot, HostScope, HostScopeRevisions } from '../../../../../src/core/assistant/hostContracts'
import type { AgentToolGatewayResult } from '../../../../../src/core/assistant/toolContracts'
import { createMainLogger } from '../../logging'
import {
  getWorkflowDefinition,
  listWorkflowDefinitions,
  parseWorkflowParams,
  type WorkflowId,
  type WorkflowStep,
} from './definitions'

const logger = createMainLogger('main.application_control.workflow')
const PLAN_TTL_MS = 30 * 60_000

interface WorkflowPlan {
  planRef: string
  workflowId: WorkflowId
  params: Record<string, unknown>
  steps: WorkflowStep[]
  createdAt: number
  initialScopeRevisions: HostScopeRevisions
}

interface WorkflowStepResult {
  stepId: string
  title: string
  toolName: string
  status: 'completed' | 'compensated' | 'compensation_failed'
  references: Record<string, string>
}

interface WorkflowCompensation {
  stepId: string
  toolName: string
  input: Record<string, unknown>
  status: 'pending' | 'completed' | 'failed'
}

interface WorkflowRun {
  workflowRunRef: string
  planRef: string
  workflowId: WorkflowId
  status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'rolled_back'
  nextStepIndex: number
  totalSteps: number
  stepResults: WorkflowStepResult[]
  outputs: Record<string, Record<string, unknown>>
  compensations: WorkflowCompensation[]
  scopeRevisions: HostScopeRevisions
  error?: { code: string; message: string }
  pauseRequested: boolean
  createdAt: number
  updatedAt: number
  controller?: AbortController
}

export interface WorkflowExecutionContext {
  runId: string
  threadId: string
  toolCallId: string
  signal: AbortSignal
  gateway: WorkflowGateway
  getHostContext: (runId: string) => HostContextSnapshot | null
}

export interface WorkflowGateway {
  execute(request: {
    runId: string
    threadId: string
    toolCallId: string
    toolName: string
    input: Record<string, unknown>
    expectedRevisions?: Record<string, number>
    approvalMode: 'full_access'
    explicitUserIntent: true
    authorizationSource: 'approved_workflow'
    parentToolCallId: string
    signal: AbortSignal
  }): Promise<AgentToolGatewayResult>
}

function cleanupExpiredPlans(plans: Map<string, WorkflowPlan>): void {
  const threshold = Date.now() - PLAN_TTL_MS
  for (const [planRef, plan] of plans) if (plan.createdAt < threshold) plans.delete(planRef)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function extractReferences(output: Record<string, unknown>): Record<string, string> {
  const references: Record<string, string> = {}
  for (const [key, value] of Object.entries(output)) {
    if (typeof value === 'string' && /(?:id|ref|task|status)$/i.test(key)) references[key] = value.slice(0, 200)
    if (isRecord(value)) {
      for (const [nestedKey, nestedValue] of Object.entries(value)) {
        if (typeof nestedValue === 'string' && /(?:id|ref|task|status)$/i.test(nestedKey)) references[nestedKey] = nestedValue.slice(0, 200)
      }
    }
  }
  return references
}

function extractScopeRevisions(output: Record<string, unknown>): Partial<HostScopeRevisions> {
  const value = output.scopeRevisions
  if (!isRecord(value)) return {}
  const revisions: Partial<HostScopeRevisions> = {}
  for (const [scope, revision] of Object.entries(value)) {
    if (typeof revision === 'number' && Number.isInteger(revision) && revision >= 0) {
      revisions[scope as HostScope] = revision
    }
  }
  return revisions
}

function resolvePlaceholders(value: unknown, outputs: Record<string, Record<string, unknown>>): unknown {
  if (typeof value === 'string' && value.startsWith('__from_previous:')) {
    const stepId = value.slice('__from_previous:'.length)
    const output = outputs[stepId]
    if (!output) throw new Error(`[WORKFLOW_STEP_OUTPUT_MISSING] 缺少步骤 ${stepId} 的输出`)
    if (typeof output.previewRef === 'string') return output.previewRef
    if (typeof output.assetId === 'string') return output.assetId
    throw new Error(`[WORKFLOW_STEP_OUTPUT_MISSING] 步骤 ${stepId} 没有可传递引用`)
  }
  if (Array.isArray(value)) return value.map((item) => resolvePlaceholders(item, outputs))
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolvePlaceholders(item, outputs)]))
  return value
}

function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return /^\[([A-Z_]+)\]/.exec(message)?.[1] ?? 'WORKFLOW_FAILED'
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/^\[[A-Z_]+\]\s*/, '').slice(0, 500)
}

export class DeterministicWorkflowService {
  private readonly plans = new Map<string, WorkflowPlan>()
  private readonly runs = new Map<string, WorkflowRun>()

  list(): Array<Record<string, unknown>> {
    return listWorkflowDefinitions().map((definition) => ({
      ...definition,
      schemaRef: `workflow.definition.${definition.id}.params/v1`,
      supportsPause: true,
      supportsCompensation: true,
    }))
  }

  plan(workflowId: string, rawParams: Record<string, unknown>, context: HostContextSnapshot | null): Record<string, unknown> {
    cleanupExpiredPlans(this.plans)
    const { definition, params } = parseWorkflowParams(workflowId, rawParams)
    const steps = definition.createSteps(params)
    const planRef = `workflow-plan:${randomUUID()}`
    const initialScopeRevisions = context?.scopeRevisions ?? { navigation: 0, generation: 0, canvas: 0, toolbox: 0, assets: 0 }
    this.plans.set(planRef, {
      planRef,
      workflowId: definition.id,
      params,
      steps,
      createdAt: Date.now(),
      initialScopeRevisions,
    })
    logger.info('确定性工作流计划已创建', {
      event: 'agent_workflow.plan.completed',
      requestId: planRef,
      context: { workflowId: definition.id, stepCount: steps.length },
    })
    return {
      planRef,
      workflowId: definition.id,
      title: definition.title,
      description: definition.description,
      steps: steps.map((step) => ({ id: step.id, title: step.title, toolName: step.toolName, scopes: step.scopes })),
      stepCount: steps.length,
      approval: '执行计划需要一次工作流审批；内部步骤按既定顺序执行。',
      reversible: steps.some((step) => Boolean(step.compensation)),
    }
  }

  get(workflowRunRef: string): Record<string, unknown> {
    const run = this.runs.get(workflowRunRef)
    if (!run) throw new Error('[NOT_FOUND] 工作流运行不存在')
    return this.formatRun(run)
  }

  preview(planRef: string): Record<string, unknown> {
    const plan = this.plans.get(planRef)
    if (!plan) throw new Error('[NOT_FOUND] 工作流计划不存在或已过期')
    const definition = getWorkflowDefinition(plan.workflowId)
    if (!definition) throw new Error('[NOT_FOUND] 工作流定义不存在')
    return {
      planRef,
      workflowId: plan.workflowId,
      title: definition.title,
      steps: plan.steps.map((step) => ({ id: step.id, title: step.title, toolName: step.toolName, scopes: step.scopes })),
      stepCount: plan.steps.length,
      reversible: plan.steps.some((step) => Boolean(step.compensation)),
    }
  }

  pause(workflowRunRef: string): Record<string, unknown> {
    const run = this.requireRun(workflowRunRef)
    if (run.status === 'running') run.pauseRequested = true
    return this.formatRun(run)
  }

  cancel(workflowRunRef: string): Record<string, unknown> {
    const run = this.requireRun(workflowRunRef)
    run.status = 'cancelled'
    run.pauseRequested = false
    run.controller?.abort('CANCELLED')
    run.updatedAt = Date.now()
    return this.formatRun(run)
  }

  async rollback(workflowRunRef: string, context: WorkflowExecutionContext): Promise<Record<string, unknown>> {
    const run = this.requireRun(workflowRunRef)
    if (run.status === 'running') throw new Error('[CONFLICT] 运行中的工作流不能直接回滚，请先暂停或取消')
    await this.compensate(run, context)
    run.status = 'rolled_back'
    run.updatedAt = Date.now()
    return this.formatRun(run)
  }

  async execute(planRef: string, context: WorkflowExecutionContext): Promise<Record<string, unknown>> {
    const plan = this.plans.get(planRef)
    if (!plan) throw new Error('[NOT_FOUND] 工作流计划不存在或已过期')
    let run = [...this.runs.values()].find((item) => item.planRef === planRef)
    if (!run) {
      run = {
        workflowRunRef: `workflow-run:${randomUUID()}`,
        planRef,
        workflowId: plan.workflowId,
        status: 'running',
        nextStepIndex: 0,
        totalSteps: plan.steps.length,
        stepResults: [],
        outputs: {},
        compensations: [],
        scopeRevisions: { ...plan.initialScopeRevisions },
        pauseRequested: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      this.runs.set(run.workflowRunRef, run)
    }
    return await this.runFrom(run, plan, context)
  }

  async resume(workflowRunRef: string, context: WorkflowExecutionContext): Promise<Record<string, unknown>> {
    const run = this.requireRun(workflowRunRef)
    const plan = this.plans.get(run.planRef)
    if (!plan) throw new Error('[NOT_FOUND] 工作流计划不存在或已过期')
    if (run.status === 'completed') return this.formatRun(run)
    run.pauseRequested = false
    return await this.runFrom(run, plan, context)
  }

  private requireRun(workflowRunRef: string): WorkflowRun {
    const run = this.runs.get(workflowRunRef)
    if (!run) throw new Error('[NOT_FOUND] 工作流运行不存在')
    return run
  }

  private async runFrom(run: WorkflowRun, plan: WorkflowPlan, context: WorkflowExecutionContext): Promise<Record<string, unknown>> {
    const controller = new AbortController()
    const onAbort = (): void => controller.abort(context.signal.reason ?? 'CANCELLED')
    context.signal.addEventListener('abort', onAbort, { once: true })
    run.controller = controller
    run.status = 'running'
    run.updatedAt = Date.now()
    logger.info('确定性工作流开始执行', {
      event: 'agent_workflow.run.start',
      requestId: context.runId,
      taskId: run.workflowRunRef,
      context: { workflowId: run.workflowId, planRef: run.planRef, startStep: run.nextStepIndex },
    })
    try {
      for (; run.nextStepIndex < plan.steps.length;) {
        if (controller.signal.aborted) throw new Error('[CANCELLED] 工作流已取消')
        if (run.pauseRequested) {
          run.status = 'paused'
          run.updatedAt = Date.now()
          logger.info('确定性工作流暂停', { event: 'agent_workflow.run.paused', requestId: context.runId, taskId: run.workflowRunRef })
          return this.formatRun(run)
        }
        const step = plan.steps[run.nextStepIndex]
        const hostContext = context.getHostContext(context.runId)
        this.assertRevision(run, step, hostContext)
        const input = resolvePlaceholders(step.input, run.outputs) as Record<string, unknown>
        logger.info('确定性工作流步骤开始', {
          event: 'agent_workflow.step.start',
          requestId: context.runId,
          taskId: run.workflowRunRef,
          context: { workflowId: run.workflowId, stepId: step.id, toolName: step.toolName, stepIndex: run.nextStepIndex },
        })
        const result = await context.gateway.execute({
          runId: context.runId,
          threadId: context.threadId,
          toolCallId: `workflow:${run.workflowRunRef}:step:${step.id}`,
          toolName: step.toolName,
          input,
          expectedRevisions: Object.fromEntries(step.scopes.map((scope) => [scope, run.scopeRevisions[scope]])),
          approvalMode: 'full_access',
          explicitUserIntent: true,
          authorizationSource: 'approved_workflow',
          parentToolCallId: context.toolCallId,
          signal: controller.signal,
        })
        if (result.status !== 'completed') throw new Error('[WORKFLOW_APPROVAL_REQUIRED] 工作流内部步骤未完成审批')
        const output = isRecord(result.observation.output) ? result.observation.output : {}
        run.outputs[step.id] = output
        Object.assign(run.scopeRevisions, extractScopeRevisions(output))
        const compensationInput = step.compensation?.(output)
        if (compensationInput) run.compensations.push({ stepId: step.id, toolName: 'undo_canvas_change', input: compensationInput, status: 'pending' })
        run.stepResults.push({ stepId: step.id, title: step.title, toolName: step.toolName, status: 'completed', references: extractReferences(output) })
        run.nextStepIndex += 1
        run.updatedAt = Date.now()
        logger.info('确定性工作流步骤完成', {
          event: 'agent_workflow.step.completed',
          requestId: context.runId,
          taskId: run.workflowRunRef,
          context: { workflowId: run.workflowId, stepId: step.id, toolName: step.toolName },
        })
        if (run.pauseRequested) {
          run.status = 'paused'
          return this.formatRun(run)
        }
      }
      run.status = 'completed'
      run.updatedAt = Date.now()
      logger.info('确定性工作流执行完成', { event: 'agent_workflow.run.completed', requestId: context.runId, taskId: run.workflowRunRef, context: { workflowId: run.workflowId } })
      return this.formatRun(run)
    } catch (error) {
      const cancelled = controller.signal.aborted || errorCode(error) === 'CANCELLED'
      run.status = cancelled ? 'cancelled' : 'failed'
      run.error = { code: cancelled ? 'CANCELLED' : errorCode(error), message: errorMessage(error) }
      run.updatedAt = Date.now()
      if (!cancelled) await this.compensate(run, context)
      logger.error('确定性工作流执行失败', {
        event: 'agent_workflow.run.failed',
        requestId: context.runId,
        taskId: run.workflowRunRef,
        context: { workflowId: run.workflowId, errorCode: run.error.code, compensated: run.compensations.filter((item) => item.status === 'completed').length },
      })
      return this.formatRun(run)
    } finally {
      context.signal.removeEventListener('abort', onAbort)
      run.controller = undefined
    }
  }

  private assertRevision(run: WorkflowRun, step: WorkflowStep, context: HostContextSnapshot | null): void {
    if (!context) throw new Error('[NOT_READY] 宿主上下文不可用')
    for (const scope of step.scopes) {
      if (context.scopeRevisions[scope] !== run.scopeRevisions[scope]) {
        throw new Error(`[STALE_CONTEXT] 工作流步骤 ${step.id} 的 ${scope} 上下文已变化`)
      }
    }
  }

  private async compensate(run: WorkflowRun, context: WorkflowExecutionContext): Promise<void> {
    for (const compensation of [...run.compensations].reverse()) {
      if (compensation.status !== 'pending') continue
      try {
        const result: AgentToolGatewayResult = await context.gateway.execute({
          runId: context.runId,
          threadId: context.threadId,
          toolCallId: `workflow:${run.workflowRunRef}:compensation:${compensation.stepId}`,
          toolName: compensation.toolName,
          input: compensation.input,
          approvalMode: 'full_access',
          explicitUserIntent: true,
          authorizationSource: 'approved_workflow',
          parentToolCallId: context.toolCallId,
          signal: context.signal,
        })
        compensation.status = result.status === 'completed' ? 'completed' : 'failed'
        logger.info('确定性工作流补偿完成', {
          event: 'agent_workflow.step.compensated',
          requestId: context.runId,
          taskId: run.workflowRunRef,
          context: { stepId: compensation.stepId, status: compensation.status },
        })
      } catch {
        compensation.status = 'failed'
        logger.warn('确定性工作流补偿失败', {
          event: 'agent_workflow.step.compensation_failed',
          requestId: context.runId,
          taskId: run.workflowRunRef,
          context: { stepId: compensation.stepId },
        })
      }
    }
  }

  private formatRun(run: WorkflowRun): Record<string, unknown> {
    return {
      workflowRunRef: run.workflowRunRef,
      planRef: run.planRef,
      workflowId: run.workflowId,
      status: run.status,
      currentStepIndex: run.nextStepIndex,
      totalSteps: run.totalSteps,
      steps: run.stepResults,
      compensations: run.compensations.map(({ stepId, toolName, status }) => ({ stepId, toolName, status })),
      error: run.error ?? null,
      scopeRevisions: run.scopeRevisions,
      revision: run.updatedAt,
      waitingExternal: false,
      cancellable: run.status === 'running' || run.status === 'paused',
      resumable: run.status === 'paused' || run.status === 'failed',
      retryable: run.status === 'failed',
      resultRefs: run.stepResults.flatMap((step) => Object.values(step.references)),
      evidence: {
        workflowRunRef: run.workflowRunRef,
        completedSteps: run.stepResults.length,
        scopeRevisions: run.scopeRevisions,
        updatedAt: new Date(run.updatedAt).toISOString(),
      },
    }
  }
}
