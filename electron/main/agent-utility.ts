import { randomUUID } from 'node:crypto'
import { z } from 'zod'

import {
  agentEventSchema,
  agentRunStateSchema,
  type AgentRunState,
} from '../../src/core/assistant/events'
import {
  type HostContextSnapshot,
} from '../../src/core/assistant/hostContracts'
import { agentMemoryRetrievalResultSchema } from '../../src/core/assistant/memory'
import {
  agentSessionCompactionAppendSchema,
  agentSessionInternalAppendSchema,
} from '../../src/core/assistant/session'
import { agentSavePointAppendSchema, agentSavePointSchema } from '../../src/core/assistant/turn'
import { agentSessionEntrySchema } from '../../src/core/assistant/session'
import {
  agentThreadTitleContextRequestSchema,
  agentThreadTitleContextSchema,
  agentThreadTitleUpdateResultSchema,
  agentThreadTitleUpdateSchema,
} from '../../src/core/assistant/threadTitle'
import {
  agentExternalWaitRecordSchema,
  agentExternalWaitRegisterSchema,
} from '../../src/core/assistant/externalWait'
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
  applyDeepSeekUsage,
  calculateModelStepKnownCostUsd,
  createCancelledError,
  createCredentialError,
  createModelStepLanguageModel,
  executeModelStepWithModel,
  executeModelStepWithRetry,
  modelStepInputSchema,
  normalizeProviderError,
  type ModelStepEvent,
  type ModelStepHttpTrace,
  type ModelStepInput,
  type ModelStepResult,
} from '@henjicc/ai-sdk'
import { AgentArtifactStore } from './services/agent-runtime/context/offload'
import { AgentRunner } from './services/agent-runtime/runner/runner'
import { AgentToolGateway } from './services/agent-runtime/tools/gateway'
import { createUtilityProxyRegistries } from './services/agent-runtime/tools/utility-proxy-registry'
import {
  createHenjiScriptService,
  createHenjiScriptTools,
} from './services/agent-runtime/henji-script/tools'
import { createMainLogger } from './services/logging'
import {
  buildModelStepTraceDetail,
  createModelStepStreamTrace,
} from './services/llm/sdk/trace'
import { executeUtilityControlCommand, releaseUtilityRunPayload } from './agent-utility-control'
import { agentUtilityStartPayloadSchema } from './agent-utility-schemas'

const parentPort = process.parentPort
if (!parentPort) throw new Error('Agent utility process 缺少父进程通信端口')

const logger = createMainLogger('main.agent_utility')
const hostContexts = new Map<string, HostContextSnapshot>()
const runThreadIds = new Map<string, string>()
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

const proxyRegistries = createUtilityProxyRegistries({
  executeMainTool: (payload, signal) => rpc('tool.execute', payload, signal),
  resolveThreadId: (runId) => runThreadIds.get(runId) ?? null,
  getHostContext: (runId) => hostContexts.get(runId) ?? null,
  rememberHostContext: (runId, context) => hostContexts.set(runId, context),
  artifactAccess: {
    describe: async (request) => agentArtifactDescriptorSchema.parse(
      await rpc('artifact.describe', agentArtifactDescribeRequestSchema.parse(request))
    ),
    read: async (request) => agentArtifactPageSchema.parse(
      await rpc('artifact.read', agentArtifactReadRequestSchema.parse(request))
    ),
  },
})
const registry = proxyRegistries.registry
const gateway = new AgentToolGateway({
  registry,
  getHostContext: (runId) => hostContexts.get(runId) ?? null,
  appendPermissionAudit,
})
const henjiScriptService = createHenjiScriptService(registry)
for (const scriptTool of createHenjiScriptTools({
  service: henjiScriptService,
  gateway,
  getHostContext: (runId) => hostContexts.get(runId) ?? null,
})) {
  registry.register(scriptTool)
  proxyRegistries.catalogRegistry.register(scriptTool)
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
    let keyResult: { apiKey: string }
    try {
      keyResult = z.object({ apiKey: z.string().min(1) }).parse(
        await rpc('model.api_key', { providerId: input.providerId })
      )
    } catch {
      throw createCredentialError(input)
    }
    const rawResult = await executeModelStepWithRetry({
      input,
      signal: controller.signal,
      emit,
      operation: (attemptEmit) => executeModelStepWithModel(
        input,
        createModelStepLanguageModel(input, keyResult.apiKey, httpTrace),
        attemptEmit,
        controller.signal,
        streamTrace
      ),
    })
    await httpTrace.usageCapture
    const result = httpTrace.deepSeekUsage
      ? (() => {
          const usage = applyDeepSeekUsage(rawResult.usage, httpTrace.deepSeekUsage)
          return {
            ...rawResult,
            usage: {
              ...usage,
              knownCostUsd: calculateModelStepKnownCostUsd(usage, input.pricing),
            },
          }
        })()
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
    const classified = controller.signal.aborted
      ? createCancelledError(input)
      : normalizeProviderError(input, error)
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
  runThreadIds.set(parsed.runId, parsed.request.threadId)
  const runner = new AgentRunner({
    runId: parsed.runId,
    request: parsed.request,
    memoryContext: parsed.memoryContext,
    conversationHistory: parsed.conversationHistory,
    conversationHistorySequences: parsed.conversationHistorySequences,
    recoveryContext: parsed.recoveryContext,
    budgetContinuation: parsed.budgetContinuation,
    dependencies: {
      registry,
      gateway,
      getHostContext: (runId) => hostContexts.get(runId) ?? null,
      runModelStep: runUtilityModelStep,
      cancelModelStep: (requestId) => activeModelSteps.get(requestId)?.abort(),
      artifactStore,
      appendSessionInternal: async (input) => {
        agentSessionInternalAppendSchema.parse(input)
        return agentSessionEntrySchema.parse(await rpc('session.append_internal', input))
      },
      appendSessionCompaction: async (input) => {
        agentSessionCompactionAppendSchema.parse(input)
        return agentSessionEntrySchema.parse(await rpc('session.append_compaction', input))
      },
      appendSavePoint: async (input) => {
        agentSavePointAppendSchema.parse(input)
        return agentSavePointSchema.parse(await rpc('session.append_save_point', input))
      },
      consumeCurrentTaskMessages: async (runId) => z.array(agentSessionEntrySchema).parse(
        await rpc('session.consume_current_messages', { runId })
      ),
      getThreadTitleContext: async (input) => {
        const request = agentThreadTitleContextRequestSchema.parse(input)
        return agentThreadTitleContextSchema.parse(
          await rpc('session.get_title_context', request)
        )
      },
      updateThreadTitle: async (input) => {
        const update = agentThreadTitleUpdateSchema.parse(input)
        return agentThreadTitleUpdateResultSchema.parse(
          await rpc('session.update_title', update)
        )
      },
      registerExternalWait: async (input) => {
        agentExternalWaitRegisterSchema.parse(input)
        return agentExternalWaitRecordSchema.parse(await rpc('external_wait.register', input))
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
  if (action === 'run.release') {
    const runId = z.object({ runId: z.string().min(1) }).parse(payload).runId
    const result = releaseUtilityRunPayload(payload, { runners, hostContexts, activeModelSteps })
    runThreadIds.delete(runId)
    return result
  }
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
