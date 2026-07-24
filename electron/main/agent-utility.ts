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
import { agentMemoryContextEntrySchema } from '../../src/core/assistant/memory'
import { agentStartRunRequestSchema } from '../../src/core/assistant/runtimeContracts'
import {
  AGENT_UTILITY_PROTOCOL_VERSION,
  agentUtilityCommandMessageSchema,
  agentUtilityRpcResultMessageSchema,
  type AgentUtilityCommandAction,
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
import { createModelStepLanguageModel } from './services/llm/sdk/provider'

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
  operation: 'model.api_key' | 'tool.execute' | 'artifact.save',
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

function createProxyRegistry(): AgentToolRegistry {
  const source = createBuiltinAgentToolRegistry(async () => {
    throw new Error('utility proxy registry 不直接执行 frontend 工具')
  })
  const proxy = new AgentToolRegistry()
  for (const definition of source.allDefinitions()) {
    const proxied: AgentToolDefinition = {
      ...definition,
      execute: async (input, context) => {
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
  return proxy
}

const registry = createProxyRegistry()
const gateway = new AgentToolGateway({
  registry,
  getHostContext: (runId) => hostContexts.get(runId) ?? null,
})
const workflowService = new DeterministicWorkflowService()
for (const workflowTool of createWorkflowTools({
  service: workflowService,
  gateway,
  getHostContext: (runId) => hostContexts.get(runId) ?? null,
})) registry.register(workflowTool)
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
  load: () => null,
})

async function runUtilityModelStep(
  rawInput: ModelStepInput,
  emit: (event: ModelStepEvent) => void
): Promise<ModelStepResult> {
  const input = modelStepInputSchema.parse(rawInput)
  const keyResult = z.object({ apiKey: z.string().min(1) }).parse(
    await rpc('model.api_key', { providerId: input.providerId })
  )
  const controller = new AbortController()
  activeModelSteps.set(input.requestId, controller)
  logger.info('utility 模型单步调用开始', {
    event: 'llm_model_step.run.start',
    requestId: input.runId,
    taskId: input.stepId,
    modelId: input.modelId,
    providerId: input.providerId,
  })
  try {
    const model = createModelStepLanguageModel(input, keyResult.apiKey)
    const result = await executeModelStepWithModel(input, model, emit, controller.signal)
    logger.info('utility 模型单步调用完成', {
      event: 'llm_model_step.run.completed',
      requestId: input.runId,
      taskId: input.stepId,
      modelId: input.modelId,
      providerId: input.providerId,
      context: { elapsedMs: result.elapsedMs, finishReason: result.finishReason },
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
      error: classified,
    })
    throw classified
  } finally {
    activeModelSteps.delete(input.requestId)
  }
}

function requireRunner(runId: string): AgentRunner {
  const runner = runners.get(runId)
  if (!runner) throw new Error(`[run_not_found] 运行不存在：${runId}`)
  return runner
}

async function handleStart(payload: unknown): Promise<AgentRunState> {
  const parsed = z.object({
    runId: z.string().min(1),
    request: agentStartRunRequestSchema,
    hostContext: hostContextSnapshotSchema,
    memoryContext: z.array(agentMemoryContextEntrySchema).max(10).default([]),
  }).strict().parse(payload)
  if (runners.has(parsed.runId)) throw new Error('[duplicate_run] 运行已存在')
  hostContexts.set(parsed.runId, parsed.hostContext)
  const runner = new AgentRunner({
    runId: parsed.runId,
    request: parsed.request,
    memoryContext: parsed.memoryContext,
    dependencies: {
      registry,
      gateway,
      getHostContext: (runId) => hostContexts.get(runId) ?? null,
      runModelStep: runUtilityModelStep,
      cancelModelStep: (requestId) => activeModelSteps.get(requestId)?.abort(),
      artifactStore,
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
  if (action === 'process.shutdown') {
    for (const runner of runners.values()) runner.cancel('应用正在退出')
    setTimeout(() => process.exit(0), 20).unref()
    return { shuttingDown: true }
  }
  const base = z.object({ runId: z.string().min(1) }).passthrough().parse(payload)
  const runner = requireRunner(base.runId)
  if (action === 'run.pause') return runner.pause()
  if (action === 'run.resume') return runner.resume()
  if (action === 'run.cancel') {
    const parsed = z.object({
      runId: z.string().min(1),
      reason: z.string().min(1).max(500),
    }).strict().parse(payload)
    return runner.cancel(parsed.reason)
  }
  const approval = z.object({
    runId: z.string().min(1),
    approvalId: z.string().min(1),
    decision: z.enum(['approve', 'reject']),
  }).strict().parse(payload)
  return runner.respondApproval(approval.approvalId, approval.decision)
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
