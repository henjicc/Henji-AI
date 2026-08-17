import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { WebContents } from 'electron'
import { z } from 'zod'

import {
  AGENT_RUNTIME_SCHEMA_VERSION,
  agentRuntimeModelConfigSchema,
  agentRuntimeProfileSchema,
  type AgentRuntimeModelConfig,
  type AgentStartRunRequest,
} from '../../../src/core/assistant/runtimeContracts'
import type { AgentEvent, AgentRunState } from '../../../src/core/assistant/events'
import type { AgentTraceRunSummary } from '../../../src/core/assistant/trace'
import type { ApplicationCapabilityResult } from '../../../src/core/assistant/hostContracts'
import {
  createFrontendToolRequest,
  getAssistantHostContext,
  requestAssistantFrontendTool,
} from '../services/assistant/frontend-tool-bridge'
import { getAssistantUserInstructions } from '../services/assistant/user-instructions'
import { getAgentRuntimeService } from '../services/agent-runtime/runtime'
import { isTerminalAgentState } from '../services/agent-runtime/runner/state-machine'
import { getDb } from '../services/db'
import { getAgentTraceStore, setAgentTraceCaptureMode, createMainLogger } from '../services/logging'
import { getAppLocalDataDir } from '../services/system'
import {
  type AssistantCliOptions,
} from './arguments'
import { waitForExternalContinuation, waitForSubmittedGenerationTasks } from './generation-wait'
import { evaluateAssistantCliAcceptance } from './acceptance'

const logger = createMainLogger('main.assistant_cli')
const HOST_READY_TIMEOUT_MS = 30_000

const storedLlmConfigSchema = z.object({
  providers: z.array(z.object({
    providerId: z.string().min(1),
    enabled: z.boolean(),
    reasoning: z.object({
      enabled: z.boolean(),
      effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']),
    }).optional(),
  }).passthrough()).min(1),
  models: z.array(agentRuntimeModelConfigSchema).min(1),
  agentProfiles: z.array(agentRuntimeProfileSchema).min(1),
  selectedAgentProfileId: z.string().min(1).optional(),
}).passthrough()
type StoredLlmConfig = z.infer<typeof storedLlmConfigSchema>

interface CliRecord {
  type: string
  [key: string]: unknown
}

function writeRecord(record: CliRecord): void {
  process.stdout.write(`${JSON.stringify(record)}\n`)
}

function writeError(message: string, error?: unknown): void {
  const detail = error instanceof Error ? error.message : undefined
  writeRecord({ type: 'error', message, ...(detail ? { detail } : {}) })
}

async function waitForHostContext(owner: WebContents, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const context = getAssistantHostContext(owner.id)
    if (context?.uiReady) return
    if (owner.isDestroyed()) throw new Error('不可见助手宿主已退出')
    await new Promise<void>((resolve) => { setTimeout(resolve, 100) })
  }
  throw new Error('等待助手宿主初始化超时')
}

export async function loadStoredLlmConfigForCli(): Promise<StoredLlmConfig> {
  return await loadLlmConfig()
}

function resolveLlmConfigPath(): string {
  const dataDirectoryRow = getDb().prepare(
    "SELECT value FROM settings WHERE key = 'custom_data_directory'"
  ).get() as { value: string } | undefined
  const dataRoot = dataDirectoryRow?.value.trim() || path.join(getAppLocalDataDir(), 'Henji-AI')
  return path.join(dataRoot, 'llm-config.json')
}

export async function saveStoredLlmConfigForCli(config: StoredLlmConfig): Promise<void> {
  const filePath = resolveLlmConfigPath()
  await fs.writeFile(filePath, `${JSON.stringify(storedLlmConfigSchema.parse(config), null, 2)}\n`, 'utf8')
}

async function loadLlmConfig(): Promise<StoredLlmConfig> {
  const dataDirectoryRow = getDb().prepare(
    "SELECT value FROM settings WHERE key = 'custom_data_directory'"
  ).get() as { value: string } | undefined
  const dataRoot = dataDirectoryRow?.value.trim() || path.join(getAppLocalDataDir(), 'Henji-AI')
  const filePath = path.join(dataRoot, 'llm-config.json')
  try {
    const raw = JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown
    return storedLlmConfigSchema.parse(raw)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`未找到大语言模型配置：${filePath}。请先在应用设置中保存智能助手模型配置。`)
    }
    throw new Error(`读取大语言模型配置失败：${filePath}`, { cause: error })
  }
}

function createRunRequest(options: AssistantCliOptions, config: StoredLlmConfig, userInstructions: string): AgentStartRunRequest {
  const profile = config.agentProfiles.find((item) => item.id === config.selectedAgentProfileId)
    ?? config.agentProfiles[0]
  if (!profile) throw new Error('尚未配置智能助手模型档案')
  const providers = new Map(config.providers.map((provider) => [provider.providerId, provider]))
  const models: AgentRuntimeModelConfig[] = config.models.map((model) => ({
    ...model,
    enabled: model.enabled && providers.get(model.providerId)?.enabled !== false,
    reasoning: providers.get(model.providerId)?.reasoning,
  }))
  return {
    schemaVersion: AGENT_RUNTIME_SCHEMA_VERSION,
    threadId: options.threadId ?? `cli-${randomUUID()}`,
    goal: options.goal,
    userInstructions: userInstructions || undefined,
    profile,
    models,
    approvalMode: options.approvalMode,
    budget: { maxDurationMs: options.timeoutMs },
  }
}

function writeTrace(run: AgentTraceRunSummary | undefined, printDetail: boolean): void {
  if (!run) {
    writeRecord({ type: 'trace_summary', found: false })
    return
  }
  writeRecord({ type: 'trace_summary', found: true, run })
  if (!printDetail) return
  const store = getAgentTraceStore()
  for (const step of run.steps) {
    writeRecord({ type: 'trace_detail', trace: store.getDetail(step.traceId) })
  }
}

async function waitForTerminalState(owner: WebContents, runId: string, timeoutMs: number): Promise<AgentRunState> {
  const runtime = getAgentRuntimeService()
  const deadline = Date.now() + timeoutMs
  let state = runtime.getRunState(owner, runId)
  while (!isTerminalAgentState(state.status)) {
    if (Date.now() >= deadline) {
      state = await runtime.cancelRun(owner, runId, '命令行运行达到超时限制')
      break
    }
    await new Promise<void>((resolve) => { setTimeout(resolve, 150) })
    state = runtime.getRunState(owner, runId)
  }
  return state
}

async function observeGenerationTask(
  owner: WebContents,
  runId: string,
  taskId: string,
  attempt: number
): Promise<ApplicationCapabilityResult> {
  const callId = randomUUID()
  return await requestAssistantFrontendTool(owner, createFrontendToolRequest({
    runId,
    toolCallId: `cli-await-generation:${taskId}:${attempt}`,
    callId,
    idempotencyKey: `${runId}:cli-await-generation:${taskId}:${attempt}:${callId}`,
    deadline: Date.now() + 15_000,
    operation: {
      kind: 'capability',
      capability: {
        id: 'get_generation_task',
        version: 1,
        input: { taskId },
      },
    },
  }))
}

async function run(options: AssistantCliOptions, owner: WebContents): Promise<number> {
  setAgentTraceCaptureMode(options.captureMode)
  await waitForHostContext(owner, HOST_READY_TIMEOUT_MS)
  const [config, instructions] = await Promise.all([loadLlmConfig(), getAssistantUserInstructions()])
  const request = createRunRequest(options, config, instructions.content)
  const runtime = getAgentRuntimeService()
  const started = await runtime.startRun(owner, request)
  const deadline = Date.now() + options.timeoutMs
  const emittedSequences = new Set<string>()
  const externalGenerationTaskIds = new Set<string>()
  const writeEvent = (runId: string, event: AgentEvent): void => {
    const key = `${runId}:${event.sequence}`
    if (emittedSequences.has(key)) return
    emittedSequences.add(key)
    if (event.type === 'ExternalWaitRegistered') externalGenerationTaskIds.add(event.taskId)
    writeRecord({ type: 'event', runId, event })
  }
  const unsubscribe = runtime.subscribeRunEvents(owner, started.runId, (event) => writeEvent(started.runId, event))
  try {
    const initialSnapshot = runtime.getRunSnapshot(owner, started.runId)
    for (const event of initialSnapshot.events) writeEvent(started.runId, event)
    writeRecord({
      type: 'started',
      runId: started.runId,
      threadId: request.threadId,
      approvalMode: request.approvalMode,
      captureMode: options.captureMode,
      timeoutMs: options.timeoutMs,
    })
    logger.info('命令行助手运行已启动', {
      event: 'assistant_cli.run.started',
      requestId: started.runId,
      context: { threadId: request.threadId, captureMode: options.captureMode, approvalMode: request.approvalMode },
    })
    const state = await waitForTerminalState(owner, started.runId, options.timeoutMs + 5_000)
    const generationWait = options.awaitGeneration
      ? await waitForSubmittedGenerationTasks({
          state,
          taskIds: [...externalGenerationTaskIds],
          timeoutMs: Math.max(0, deadline - Date.now()),
          observe: async (taskId, attempt) => await observeGenerationTask(owner, started.runId, taskId, attempt),
          onObservation: (task) => writeRecord({ type: 'generation_task_observation', runId: started.runId, task }),
        })
      : null
    if (generationWait) {
      writeRecord({ type: 'generation_task_wait', runId: started.runId, ...generationWait })
    }
    const continuation = generationWait && generationWait.status !== 'timed_out'
      ? await waitForExternalContinuation({
          sourceRunId: started.runId,
          threadId: request.threadId,
          sourceState: state,
          timeoutMs: Math.max(0, deadline - Date.now()),
          listRuns: (threadId) => runtime.listRuns(threadId, 100),
          getState: (runId) => runtime.getRunState(owner, runId),
        })
      : null
    const finalRunId = continuation?.runId ?? started.runId
    const finalState = continuation?.state ?? state
    if (continuation) {
      writeRecord({ type: 'external_continuation', sourceRunId: started.runId, ...continuation })
      if (finalRunId !== started.runId) {
        for (const event of runtime.getRunSnapshot(owner, finalRunId).events) writeEvent(finalRunId, event)
      }
    }
    const completedExternalEffects = generationWait?.status === 'completed'
      ? generationWait.tasks.filter((task) => task.status === 'completed').length
      : 0
    const acceptance = evaluateAssistantCliAcceptance(
      finalState,
      options.requireVerifiedWrite,
      completedExternalEffects,
    )
    writeRecord({ type: 'acceptance', runId: finalRunId, acceptance })
    const traces = getAgentTraceStore().query({ runId: finalRunId, limit: 200 })
    const trace = traces.runs.find((item) => item.runId === finalRunId)
    writeRecord({ type: 'finished', runId: finalRunId, sourceRunId: started.runId, state: finalState })
    writeTrace(trace, options.printTrace)
    logger.info('命令行助手运行结束', {
      event: 'assistant_cli.run.completed',
      requestId: started.runId,
      context: {
        status: finalState.status,
        turns: finalState.usage.turns,
        totalTokens: finalState.usage.totalTokens,
        generationWaitStatus: generationWait?.status ?? null,
        continuationStatus: continuation?.status ?? null,
        acceptancePassed: acceptance.passed,
        effectCount: acceptance.effectCount,
        mutationCount: acceptance.mutationCount,
      },
    })
    return acceptance.passed
      && (!generationWait || generationWait.status === 'completed' || generationWait.status === 'skipped')
      && (!continuation || continuation.status === 'completed' || continuation.status === 'skipped')
      ? 0
      : 1
  } finally {
    unsubscribe()
  }
}

export async function runAssistantCli(owner: WebContents, options: AssistantCliOptions): Promise<number> {
  try {
    return await run(options, owner)
  } catch (error) {
    writeError('命令行助手运行失败', error)
    logger.error('命令行助手运行失败', {
      event: 'assistant_cli.run.failed',
      error,
    })
    return 1
  }
}

