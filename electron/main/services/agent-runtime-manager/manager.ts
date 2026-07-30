import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { utilityProcess, type UtilityProcess } from 'electron'

import {
  agentEventSchema,
  agentRunStateSchema,
  type AgentEvent,
  type AgentRunState,
} from '../../../../src/core/assistant/events'
import type { HostContextSnapshot } from '../../../../src/core/assistant/hostContracts'
import type { AgentStartRunRequest } from '../../../../src/core/assistant/runtimeContracts'
import type { AgentMemoryContextEntry } from '../../../../src/core/assistant/memory'
import type { AgentWorkingSummary } from '../../../../src/core/assistant/workingContext'
import type { ModelStepMessage } from '../../../../src/core/llm/modelStep'
import type {
  AgentTraceCompleteInput,
  AgentTraceFailInput,
  AgentTraceStartInput,
} from '../../../../src/core/assistant/trace'
import type { AgentTraceCaptureMode } from '../../../../src/core/assistant/trace'
import {
  AGENT_UTILITY_PROTOCOL_VERSION,
  agentUtilityCheckpointMessageSchema,
  agentUtilityCommandResultMessageSchema,
  agentUtilityHeartbeatMessageSchema,
  agentUtilityLogMessageSchema,
  agentUtilityReadyMessageSchema,
  agentUtilityRpcCancelMessageSchema,
  agentUtilityRpcRequestMessageSchema,
  agentUtilityRunEventMessageSchema,
  type AgentUtilityCommandAction,
  type AgentUtilityRpcOperation,
} from '../../../../src/core/assistant/utilityContracts'
import { appendLogEvents, createMainLogger } from '../logging'

const logger = createMainLogger('main.agent_runtime_manager')
const HEARTBEAT_TIMEOUT_MS = 15_000

interface AgentRuntimeManagerOptions {
  getModelApiKey: (providerId: string) => string | null
  executeTool: (payload: unknown, signal: AbortSignal) => Promise<unknown>
  saveArtifact: (payload: unknown) => void
  describeArtifact: (payload: unknown) => unknown
  readArtifact: (payload: unknown) => unknown
  retrieveMemory: (payload: unknown) => unknown
  onEvent: (runId: string, event: AgentEvent) => void
  onCheckpoint: (runId: string, state: AgentRunState) => void
  onTerminal: (runId: string, state: AgentRunState) => void
  onProcessFailure: (runIds: string[], reason: string) => void
  getAgentTraceCaptureMode: () => AgentTraceCaptureMode
  startAgentTrace: (payload: AgentTraceStartInput) => void
  completeAgentTrace: (payload: AgentTraceCompleteInput) => void
  failAgentTrace: (payload: AgentTraceFailInput) => void
  appendPermissionAudit: (payload: unknown) => unknown
  appendSessionInternal: (payload: unknown) => unknown
  appendSessionCompaction: (payload: unknown) => unknown
  appendSavePoint: (payload: unknown) => unknown
  consumeCurrentTaskMessages: (payload: unknown) => unknown
  registerExternalWait: (payload: unknown) => unknown
}

interface PendingCommand {
  timer: ReturnType<typeof setTimeout>
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

function messageError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

export class AgentRuntimeManager {
  private process: UtilityProcess | null = null
  private spawning: Promise<void> | null = null
  private ready = false
  private readyResolver: (() => void) | null = null
  private readyRejecter: ((error: Error) => void) | null = null
  private lastHeartbeatAt = 0
  private readonly pending = new Map<string, PendingCommand>()
  private readonly activeRunIds = new Set<string>()
  private readonly rpcControllers = new Map<string, AbortController>()
  private disposing = false
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly options: AgentRuntimeManagerOptions) {}

  async startRun(
    runId: string,
    request: AgentStartRunRequest,
    hostContext: HostContextSnapshot,
    memoryContext: AgentMemoryContextEntry[],
    conversationHistory: ModelStepMessage[],
    conversationHistorySequences: number[],
    recoveryContext?: AgentWorkingSummary
  ): Promise<AgentRunState> {
    this.activeRunIds.add(runId)
    try {
      const result = await this.invoke('run.start', {
        runId,
        request,
        hostContext,
        memoryContext,
        conversationHistory,
        conversationHistorySequences,
        recoveryContext,
      }, 15_000)
      return agentRunStateSchema.parse(result)
    } catch (error) {
      this.activeRunIds.delete(runId)
      throw error
    }
  }

  async pauseRun(runId: string): Promise<AgentRunState> {
    return agentRunStateSchema.parse(await this.invoke('run.pause', { runId }))
  }

  async resumeRun(runId: string): Promise<AgentRunState> {
    return agentRunStateSchema.parse(await this.invoke('run.resume', { runId }))
  }

  async cancelRun(runId: string, reason: string): Promise<AgentRunState> {
    return agentRunStateSchema.parse(await this.invoke('run.cancel', { runId, reason }))
  }

  async respondApproval(
    runId: string,
    approvalId: string,
    decision: 'approve' | 'reject'
  ): Promise<AgentRunState> {
    return agentRunStateSchema.parse(await this.invoke('run.approval', {
      runId,
      approvalId,
      decision,
    }))
  }

  async respondClarification(runId: string, waitId: string, content: string): Promise<AgentRunState> {
    return agentRunStateSchema.parse(await this.invoke('run.clarification', {
      runId,
      waitId,
      content,
    }))
  }

  async dispose(): Promise<void> {
    this.disposing = true
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
    if (!this.process) return
    try {
      await this.invoke('process.shutdown', {}, 1_000)
    } catch {
      this.process.kill()
    }
    this.process = null
    this.ready = false
  }

  private async invoke(
    action: AgentUtilityCommandAction,
    payload: unknown,
    timeoutMs = 10_000
  ): Promise<unknown> {
    if (action !== 'process.shutdown') await this.ensureReady()
    const child = this.process
    if (!child || !this.ready) throw new Error('[utility_not_ready] Agent utility process 尚未就绪')
    const requestId = randomUUID()
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error(`[utility_timeout] utility 命令超时：${action}`))
      }, timeoutMs)
      this.pending.set(requestId, { timer, resolve, reject })
      child.postMessage({
        type: 'command.request',
        protocolVersion: AGENT_UTILITY_PROTOCOL_VERSION,
        requestId,
        action,
        payload,
      })
    })
  }

  private async ensureReady(): Promise<void> {
    if (this.ready && this.process) return
    if (this.spawning) return await this.spawning
    this.spawning = this.spawn()
    try {
      await this.spawning
    } finally {
      this.spawning = null
    }
  }

  private async spawn(): Promise<void> {
    if (this.disposing) throw new Error('[utility_disposed] Agent utility process 已关闭')
    const entryPath = path.join(__dirname, 'agent-utility.cjs')
    const child = utilityProcess.fork(entryPath, [], {
      serviceName: '痕迹AI智能助手运行时',
      stdio: 'pipe',
    })
    this.process = child
    this.ready = false
    this.lastHeartbeatAt = Date.now()
    child.on('message', (message: unknown) => this.handleMessage(message))
    child.on('error', (type, location, report) => {
      logger.error('Agent utility process 出现致命错误', {
        event: 'agent_runtime_process.error',
        context: { type, location, reportLength: report.length },
      })
    })
    child.on('exit', (code) => this.handleExit(code))
    child.on('spawn', () => {
      logger.info('Agent utility process 已启动', {
        event: 'agent_runtime_process.started',
        context: { pid: child.pid },
      })
    })

    const readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolver = resolve
      this.readyRejecter = reject
    })
    const timeout = setTimeout(() => {
      this.readyRejecter?.(new Error('[utility_handshake_timeout] utility 版本握手超时'))
      child.kill()
    }, 10_000)
    try {
      await readyPromise
    } finally {
      clearTimeout(timeout)
      this.readyResolver = null
      this.readyRejecter = null
    }
    this.startHeartbeatMonitor()
  }

  private startHeartbeatMonitor(): void {
    if (this.heartbeatTimer) return
    this.heartbeatTimer = setInterval(() => {
      if (!this.process || !this.ready) return
      if (Date.now() - this.lastHeartbeatAt <= HEARTBEAT_TIMEOUT_MS) return
      logger.error('Agent utility process 心跳超时', {
        event: 'agent_runtime_process.heartbeat_timeout',
        context: { pid: this.process.pid, timeoutMs: HEARTBEAT_TIMEOUT_MS },
      })
      this.process.kill()
    }, 5_000)
    this.heartbeatTimer.unref()
  }

  private handleMessage(raw: unknown): void {
    const ready = agentUtilityReadyMessageSchema.safeParse(raw)
    if (ready.success) {
      this.ready = true
      this.lastHeartbeatAt = Date.now()
      this.readyResolver?.()
      logger.info('Agent utility process 版本握手完成', {
        event: 'agent_runtime_process.ready',
        context: {
          pid: ready.data.pid,
          protocolVersion: ready.data.protocolVersion,
        },
      })
      return
    }
    const heartbeat = agentUtilityHeartbeatMessageSchema.safeParse(raw)
    if (heartbeat.success) {
      this.lastHeartbeatAt = Date.now()
      return
    }
    const result = agentUtilityCommandResultMessageSchema.safeParse(raw)
    if (result.success) {
      const pending = this.pending.get(result.data.requestId)
      if (!pending) return
      this.pending.delete(result.data.requestId)
      clearTimeout(pending.timer)
      if (result.data.ok) pending.resolve(result.data.data)
      else pending.reject(new Error(result.data.error?.message ?? 'utility 命令失败'))
      return
    }
    const event = agentUtilityRunEventMessageSchema.safeParse(raw)
    if (event.success) {
      this.options.onEvent(event.data.runId, agentEventSchema.parse(event.data.event))
      return
    }
    const checkpoint = agentUtilityCheckpointMessageSchema.safeParse(raw)
    if (checkpoint.success) {
      const state = agentRunStateSchema.parse(checkpoint.data.state)
      if (checkpoint.data.type === 'run.terminal') {
        this.activeRunIds.delete(checkpoint.data.runId)
        this.options.onTerminal(checkpoint.data.runId, state)
        void this.invoke('run.release', { runId: checkpoint.data.runId }).catch((error) => {
          logger.warn('Agent 终局资源释放确认失败', {
            event: 'agent_runtime_process.run.release.failed',
            requestId: checkpoint.data.runId,
            error,
          })
        })
      } else {
        this.options.onCheckpoint(checkpoint.data.runId, state)
      }
      return
    }
    const rpc = agentUtilityRpcRequestMessageSchema.safeParse(raw)
    if (rpc.success) {
      void this.handleRpc(rpc.data.rpcId, rpc.data.operation, rpc.data.payload)
      return
    }
    const rpcCancel = agentUtilityRpcCancelMessageSchema.safeParse(raw)
    if (rpcCancel.success) {
      this.rpcControllers.get(rpcCancel.data.rpcId)?.abort(rpcCancel.data.reason)
      return
    }
    const log = agentUtilityLogMessageSchema.safeParse(raw)
    if (log.success) {
      if (!log.data.event.domain.startsWith('main.')) return
      void appendLogEvents([log.data.event])
      return
    }
    logger.warn('丢弃无效 Agent utility process 消息', {
      event: 'agent_runtime_process.message.invalid',
    })
  }

  private async handleRpc(
    rpcId: string,
    operation: AgentUtilityRpcOperation,
    payload: unknown
  ): Promise<void> {
    try {
      let data: unknown
      if (operation === 'model.api_key') {
        const providerId = typeof payload === 'object' && payload
          ? Reflect.get(payload, 'providerId')
          : null
        if (typeof providerId !== 'string') throw new Error('模型供应商参数无效')
        const apiKey = this.options.getModelApiKey(providerId)
        if (!apiKey) throw new Error(`[api_key_missing] LLM provider "${providerId}" API key is not configured.`)
        data = { apiKey }
      } else if (operation === 'tool.execute') {
        const controller = new AbortController()
        this.rpcControllers.set(rpcId, controller)
        try {
          data = await this.options.executeTool(payload, controller.signal)
        } finally {
          this.rpcControllers.delete(rpcId)
        }
      } else if (operation === 'artifact.save') {
        this.options.saveArtifact(payload)
        data = { saved: true }
      } else if (operation === 'artifact.describe') {
        data = this.options.describeArtifact(payload)
      } else if (operation === 'artifact.read') {
        data = this.options.readArtifact(payload)
      } else if (operation === 'agent_trace.get_config') {
        data = { mode: this.options.getAgentTraceCaptureMode() }
      } else if (operation === 'agent_trace.start') {
        this.options.startAgentTrace(payload as AgentTraceStartInput)
        data = { saved: true }
      } else if (operation === 'agent_trace.complete') {
        this.options.completeAgentTrace(payload as AgentTraceCompleteInput)
        data = { saved: true }
      } else if (operation === 'agent_trace.fail') {
        this.options.failAgentTrace(payload as AgentTraceFailInput)
        data = { saved: true }
      } else if (operation === 'permission_audit.append') {
        data = this.options.appendPermissionAudit(payload)
      } else if (operation === 'memory.retrieve') {
        data = this.options.retrieveMemory(payload)
      } else if (operation === 'session.append_internal') {
        data = this.options.appendSessionInternal(payload)
      } else if (operation === 'session.append_compaction') {
        data = this.options.appendSessionCompaction(payload)
      } else if (operation === 'session.append_save_point') {
        data = this.options.appendSavePoint(payload)
      } else if (operation === 'session.consume_current_messages') {
        data = this.options.consumeCurrentTaskMessages(payload)
      } else if (operation === 'external_wait.register') {
        data = this.options.registerExternalWait(payload)
      } else {
        throw new Error(`不支持的 utility RPC 操作：${String(operation)}`)
      }
      this.postRpcResult(rpcId, true, data)
    } catch (error) {
      this.postRpcResult(rpcId, false, undefined, messageError(error))
    }
  }

  private postRpcResult(
    rpcId: string,
    ok: boolean,
    data?: unknown,
    error?: Error
  ): void {
    this.process?.postMessage({
      type: 'rpc.result',
      protocolVersion: AGENT_UTILITY_PROTOCOL_VERSION,
      rpcId,
      ok,
      data,
      error: error ? {
        code: error.name || 'RPC_FAILED',
        message: error.message.slice(0, 2_000),
      } : undefined,
    })
  }

  private handleExit(code: number): void {
    const wasReady = this.ready
    this.ready = false
    this.process = null
    this.readyRejecter?.(new Error(`[utility_exit] utility 退出：${code}`))
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error(`[utility_exit] utility 退出：${code}`))
    }
    this.pending.clear()
    for (const controller of this.rpcControllers.values()) controller.abort('UTILITY_EXIT')
    this.rpcControllers.clear()
    const interrupted = [...this.activeRunIds]
    this.activeRunIds.clear()
    if (!this.disposing && (wasReady || interrupted.length > 0)) {
      this.options.onProcessFailure(interrupted, `utility process 异常退出（code=${code}）`)
      logger.error('Agent utility process 异常退出', {
        event: 'agent_runtime_process.crashed',
        context: { code, interruptedRuns: interrupted.length },
      })
      setTimeout(() => {
        void this.ensureReady().catch((error) => {
          logger.error('Agent utility process 自动重启失败', {
            event: 'agent_runtime_process.restart.failed',
            error,
          })
        })
      }, 500).unref()
    } else {
      logger.info('Agent utility process 已退出', {
        event: 'agent_runtime_process.exited',
        context: { code },
      })
    }
  }
}
