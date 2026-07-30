import { randomUUID } from 'node:crypto'
import { z } from 'zod'

import {
  agentEventSchema,
  agentRunStateSchema,
  type AgentRunState,
} from '../../src/core/assistant/events'
import {
  hostContextSnapshotSchema,
  type HostContextSnapshot,
} from '../../src/core/assistant/hostContracts'
import { agentMemoryRetrievalResultSchema } from '../../src/core/assistant/memory'
import {
  agentSessionCompactionAppendSchema,
} from '../../src/core/assistant/session'
import {
  agentArtifactDescribeRequestSchema,
  agentArtifactDescriptorSchema,
  agentArtifactPageSchema,
  agentArtifactReadRequestSchema,
} from '../../src/core/assistant/artifacts'
import {
  agentTraceCaptureModeSchema,
  type AgentTraceCaptureMode,
} from '../../src/core/assistant/trace'
import {
  agentPermissionAuditAppendResultSchema,
  agentPermissionAuditFactSchema,
  type AgentPermissionAuditFact,
} from '../../src/core/assistant/permissionAudit'
import { sanitizeAgentTraceValue } from '../../src/core/assistant/traceSanitize'
import {
  AGENT_UTILITY_PROTOCOL_VERSION,
  agentUtilityCommandMessageSchema,
  agentUtilityRpcResultMessageSchema,
  type AgentUtilityCommandAction,
  type AgentUtilityRpcOperation,
} from '../../src/core/assistant/utilityContracts'
import {
  modelStepInputSchema,
  type ModelStepEvent,
  type ModelStepInput,
  type ModelStepResult,
} from '../../src/core/llm/modelStep'
import { AgentArtifactStore } from './services/agent-runtime/context/offload'
import { AgentRunner } from './services/agent-runtime/runner/runner'
import { createBuiltinAgentToolRegistry } from './services/agent-runtime/tools/builtin'
import { AgentToolGateway } from './services/agent-runtime/tools/gateway'
import { AgentToolRegistry } from './services/agent-runtime/tools/registry'
import type { AgentToolDefinition } from './services/agent-runtime/tools/types'
import { DeterministicWorkflowService } from './services/agent-runtime/workflows/service'
import { createWorkflowTools } from './services/agent-runtime/workflows/tools'
import { createMainLogger } from './services/logging'
import { executeModelStepWithModel } from './services/llm/sdk/model-step'
import {
  applyDeepSeekUsage,
  createModelStepLanguageModel,
  type ModelStepHttpTrace,
} from './services/llm/sdk/provider'
import {
  buildModelStepTraceDetail,
  createModelStepStreamTrace,
} from './services/llm/sdk/trace'
import { executeUtilityControlCommand } from './agent-utility-control'
import { agentUtilityStartPayloadSchema } from './agent-utility-schemas'

const parentPort = process.parentPort
if (!parentPort) throw new Error('Agent utility process 缺少父进程通信端口')

const logger = createMainLogger('main.agent_utility')
const hostContexts = new Map<string, HostContextSnapshot>()
const runners = new Map<string, AgentRunner>()
const activeModelSteps = new Map<string, AbortController>()
const pendingRpc = new Map<string, {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  dispose: () => void
}>()

function post(message: Record<string, unknown>): void {
  parentPort.postMessage({
    ...message,
    protocolVersion: AGENT_UTILITY_PROTOCOL_VERSION,
  })
}

function rpc(
  operation: AgentUtilityRpcOperation,
  payload: unknown,
  signal?: AbortSignal
): Promise<unknown> {
  const rpcId = randomUUID()
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      const pending = pendingRpc.get(rpcId)
      if (!pending) return
      pendingRpc.delete(rpcId)
      pending.dispose()
      post({
        type: 'rpc.cancel',
        rpcId,
        reason: signal?.reason === 'TIMEOUT' ? 'TIMEOUT' : 'CANCELLED',
      })
      reject(new Error(signal?.reason === 'TIMEOUT' ? 'TIMEOUT' : 'CANCELLED'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    pendingRpc.set(rpcId, {
      resolve,
      reject,
      dispose: () => signal?.removeEventListener('abort', onAbort),
    })
    if (signal?.aborted) {
      onAbort()
      return
    }
    post({ type: 'rpc.request', rpcId, operation, payload })
  })
}

export async function appendPermissionAudit(
  rawFact: AgentPermissionAuditFact
): Promise<void> {
  const fact = agentPermissionAuditFactSchema.parse(rawFact)
  agentPermissionAuditAppendResultSchema.parse(
    await rpc('permission_audit.append', fact)
  )
}

function createProxyRegistry(): {
  registry: AgentToolRegistry
  catalogRegistry: AgentToolRegistry
} {
  const source = createBuiltinAgentToolRegistry(
    async () => { throw new Error('utility proxy registry 不直接执行 frontend 工具') },
    {
      describe: async (request) => agentArtifactDescriptorSchema.parse(
        await rpc('artifact.describe', agentArtifactDescribeRequestSchema.parse(request))
      ),
      read: async (request) => agentArtifactPageSchema.parse(
        await rpc('artifact.read', agentArtifactReadRequestSchema.parse(request))
      ),
    }
  )
  const proxy = new AgentToolRegistry()
  for (const definition of source.allDefinitions()) {
    const proxied: AgentToolDefinition = {
      ...definition,
      execute: definition.name === 'read_agent_artifact'
        || definition.name === 'search_application_capabilities'
        ? definition.execute
        : async (input, context) => {
          const response = await rpc('tool.execute', {
            runId: context.runId,
            threadId: context.threadId,
            toolCallId: context.toolCallId,
            toolName: definition.name,
            input,
          }, context.signal)
          const parsed = z.object({
            output: z.unknown(),
            hostContext: hostContextSnapshotSchema.nullable(),
          }).parse(response)
          if (parsed.hostContext) hostContexts.set(context.runId, parsed.hostContext)
          return parsed.output
        },
    }
    proxy.register(proxied)
  }
  return { registry: proxy, catalogRegistry: source }
}

const proxyRegistries = createProxyRegistry()
const registry = proxyRegistries.registry
const gateway = new AgentToolGateway({
  registry,
  getHostContext: (runId) => hostContexts.get(runId) ?? null,
  appendPermissionAudit,
})
const workflowService = new DeterministicWorkflowService()
for (const workflowTool of createWorkflowTools({
  service: workflowService,
  gateway,
  getHostContext: (runId) => hostContexts.get(runId) ?? null,
})) {
  registry.register(workflowTool)
  proxyRegistries.catalogRegistry.register(workflowTool)
}
const artifactStore = new AgentArtifactStore({
  save: (runId, artifact) => {
    void rpc('artifact.save', { runId, artifact }).catch((error) => {
      logger.warn('Agent 大结果持久化代理失败', {
        event: 'agent_utility.artifact.persist.failed',
        requestId: runId,
        context: { errorName: error.name },
      })
    })
  },
})

async function runUtilityModelStep(
  rawInput: ModelStepInput,
  emit: (event: ModelStepEvent) => void
): Promise<ModelStepResult> {
  const input = modelStepInputSchema.parse(rawInput)
  const controller = new AbortController()
  const startedAt = Date.now()
  const traceId = randomUUID()
  const captureMode = await getAgentTraceCaptureMode()
  const httpTrace: ModelStepHttpTrace = { captureHttp: captureMode === 'detailed' }
  const streamTrace = captureMode === 'detailed' ? createModelStepStreamTrace() : undefined
  activeModelSteps.set(input.requestId, controller)
  await startAgentTrace(input, traceId, captureMode, startedAt)
  logger.info('utility 模型单步调用开始', {
    event: 'llm_model_step.run.start',
    requestId: input.runId,
    taskId: input.stepId,
    modelId: input.modelId,
    providerId: input.providerId,
    context: { traceId, captureMode },
  })
  try {
    const keyResult = z.object({ apiKey: z.string().min(1) }).parse(
      await rpc('model.api_key', { providerId: input.providerId })
    )
    const model = createModelStepLanguageModel(
      input,
      keyResult.apiKey,
      httpTrace
    )
    const rawResult = await executeModelStepWithModel(input, model, emit, controller.signal, streamTrace)
    await httpTrace.usageCapture
    const result = httpTrace.deepSeekUsage
      ? { ...rawResult, usage: applyDeepSeekUsage(rawResult.usage, httpTrace.deepSeekUsage) }
      : rawResult
    await finishAgentTrace(input, traceId, captureMode, startedAt, httpTrace, streamTrace, result)
    logger.info('utility 模型单步调用完成', {
      event: 'llm_model_step.run.completed',
      requestId: input.runId,
      taskId: input.stepId,
      modelId: input.modelId,
      providerId: input.providerId,
      context: { traceId, captureMode, elapsedMs: result.elapsedMs, finishReason: result.finishReason },
    })
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const classified = controller.signal.aborted
      ? new Error(`[task_cancelled] LLM model step cancelled: ${input.requestId}`)
      : error instanceof Error && error.message.startsWith('[')
        ? error
        : new Error(`[model_step_failed] ${message}`)
    logger.error('utility 模型单步调用失败', {
      event: 'llm_model_step.run.failed',
      requestId: input.runId,
      taskId: input.stepId,
      modelId: input.modelId,
      providerId: input.providerId,
      context: { traceId, captureMode },
      error: {
        name: classified.name,
        message: sanitizeAgentTraceValue(classified.message),
      },
    })
    await failAgentTrace(input, traceId, captureMode, startedAt, httpTrace, streamTrace, classified)
    throw classified
  } finally {
    activeModelSteps.delete(input.requestId)
  }
}

async function getAgentTraceCaptureMode(): Promise<AgentTraceCaptureMode> {
  try {
    const result = z.object({ mode: agentTraceCaptureModeSchema }).parse(
      await rpc('agent_trace.get_config', {})
    )
    return result.mode
  } catch {
    return 'summary'
  }
}

async function startAgentTrace(
  input: ModelStepInput,
  traceId: string,
  captureMode: AgentTraceCaptureMode,
  startedAt: number
): Promise<void> {
  try {
    await rpc('agent_trace.start', {
      traceId,
      runId: input.runId,
      requestId: input.requestId,
      stepId: input.stepId,
      kind: input.trace?.kind ?? (input.stepId.startsWith('router:') ? 'router' : 'other'),
      turn: input.trace?.turn,
      providerId: input.providerId,
      modelId: input.modelId,
      startedAt: new Date(startedAt).toISOString(),
      captureMode,
    })
  } catch (error) {
    logger.warn('Agent 模型追踪开始记录失败', {
      event: 'agent_trace.start.failed',
      requestId: input.runId,
      taskId: input.stepId,
      context: { traceId, errorName: error instanceof Error ? error.name : 'unknown' },
    })
  }
}

async function finishAgentTrace(
  input: ModelStepInput,
  traceId: string,
  captureMode: AgentTraceCaptureMode,
  startedAt: number,
  httpTrace: ModelStepHttpTrace,
  streamTrace: ReturnType<typeof createModelStepStreamTrace> | undefined,
  result: ModelStepResult
): Promise<void> {
  try {
    const detail = captureMode === 'detailed' && streamTrace
      ? buildModelStepTraceDetail(input, httpTrace, streamTrace, result)
      : undefined
    await rpc('agent_trace.complete', {
      traceId,
      completedAt: new Date().toISOString(),
      elapsedMs: Date.now() - startedAt,
      finishReason: result.finishReason,
      usage: result.usage,
      detail,
    })
  } catch (error) {
    logger.warn('Agent 模型追踪完成记录失败', {
      event: 'agent_trace.complete.failed',
      requestId: input.runId,
      taskId: input.stepId,
      context: { traceId, errorName: error instanceof Error ? error.name : 'unknown' },
    })
  }
}

async function failAgentTrace(
  input: ModelStepInput,
  traceId: string,
  captureMode: AgentTraceCaptureMode,
  startedAt: number,
  httpTrace: ModelStepHttpTrace,
  streamTrace: ReturnType<typeof createModelStepStreamTrace> | undefined,
  error: Error
): Promise<void> {
  try {
    const detail = captureMode === 'detailed' && streamTrace
      ? buildModelStepTraceDetail(input, httpTrace, streamTrace, undefined, error)
      : undefined
    await rpc('agent_trace.fail', {
      traceId,
      completedAt: new Date().toISOString(),
      elapsedMs: Date.now() - startedAt,
      status: error.message.startsWith('[task_cancelled]') ? 'cancelled' : 'failed',
      usage: {
        inputTokens: null,
        inputNoCacheTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        outputTokens: null,
        textTokens: null,
        reasoningTokens: null,
        totalTokens: null,
      },
      error: {
        name: error.name,
        message: error.message,
        code: error.message.match(/^\[([^\]]+)]/)?.[1],
      },
      detail,
    })
  } catch (traceError) {
    logger.warn('Agent 模型追踪失败记录失败', {
      event: 'agent_trace.fail.failed',
      requestId: input.runId,
      taskId: input.stepId,
      context: { traceId, errorName: traceError instanceof Error ? traceError.name : 'unknown' },
    })
  }
}

function requireRunner(runId: string): AgentRunner {
  const runner = runners.get(runId)
  if (!runner) throw new Error(`[run_not_found] 运行不存在：${runId}`)
  return runner
}

async function handleStart(payload: unknown): Promise<AgentRunState> {
  const parsed = agentUtilityStartPayloadSchema.parse(payload)
  if (runners.has(parsed.runId)) throw new Error('[duplicate_run] 运行已存在')
  hostContexts.set(parsed.runId, parsed.hostContext)
  const runner = new AgentRunner({
    runId: parsed.runId,
    request: parsed.request,
    memoryContext: parsed.memoryContext,
    conversationHistory: parsed.conversationHistory,
    conversationHistorySequences: parsed.conversationHistorySequences,
    recoveryContext: parsed.recoveryContext,
    dependencies: {
      registry,
      gateway,
      getHostContext: (runId) => hostContexts.get(runId) ?? null,
      runModelStep: runUtilityModelStep,
      cancelModelStep: (requestId) => activeModelSteps.get(requestId)?.abort(),
      artifactStore,
      appendSessionCompaction: async (input) => {
        agentSessionCompactionAppendSchema.parse(input)
        await rpc('session.append_compaction', input)
      },
      retrieveMemory: async (query, signal) => agentMemoryRetrievalResultSchema.parse(
        await rpc('memory.retrieve', query, signal)
      ),
      onEvent: (event) => post({
        type: 'run.event',
        runId: parsed.runId,
        event: agentEventSchema.parse(event),
      }),
      onCheckpoint: (state) => post({
        type: 'run.checkpoint',
        runId: parsed.runId,
        state: agentRunStateSchema.parse(state),
      }),
      onTerminal: (state) => post({
        type: 'run.terminal',
        runId: parsed.runId,
        state: agentRunStateSchema.parse(state),
      }),
    },
  })
  runners.set(parsed.runId, runner)
  return runner.start()
}

async function executeCommand(action: AgentUtilityCommandAction, payload: unknown): Promise<unknown> {
  if (action === 'run.start') return await handleStart(payload)
  return await executeUtilityControlCommand({
    action,
    payload,
    requireRunner,
    runners: runners.values(),
  })
}

parentPort.on('message', (messageEvent) => {
  const raw = messageEvent.data
  const rpcResult = agentUtilityRpcResultMessageSchema.safeParse(raw)
  if (rpcResult.success) {
    const pending = pendingRpc.get(rpcResult.data.rpcId)
    if (!pending) return
    pendingRpc.delete(rpcResult.data.rpcId)
    pending.dispose()
    if (rpcResult.data.ok) pending.resolve(rpcResult.data.data)
    else pending.reject(new Error(rpcResult.data.error?.message ?? '主进程 RPC 失败'))
    return
  }

  const command = agentUtilityCommandMessageSchema.safeParse(raw)
  if (!command.success) {
    logger.warn('丢弃无效 utility 消息', {
      event: 'agent_utility.message.invalid',
      context: { issues: command.error.issues.length },
    })
    return
  }
  void executeCommand(command.data.action, command.data.payload)
    .then((data) => post({
      type: 'command.result',
      requestId: command.data.requestId,
      ok: true,
      data,
    }))
    .catch((error) => post({
      type: 'command.result',
      requestId: command.data.requestId,
      ok: false,
      error: {
        code: error instanceof z.ZodError ? 'INVALID_PAYLOAD' : 'UTILITY_COMMAND_FAILED',
        message: error instanceof Error ? error.message.slice(0, 2_000) : 'utility 命令失败',
      },
    }))
})

post({
  type: 'utility.ready',
  pid: process.pid,
})
setInterval(() => post({
  type: 'utility.heartbeat',
  sentAt: Date.now(),
}), 5_000).unref()
