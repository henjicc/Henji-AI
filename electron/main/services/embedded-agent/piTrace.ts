import type { ModelStepUsage } from '@henjicc/ai-sdk'
import { createMainLogger, getAgentTraceStore } from '../logging'
import type { EngineEvent } from './contracts'

type EngineLog = Extract<EngineEvent, { type: 'log' }>
const logger = createMainLogger('main.embedded_agent')
/** 每个运行正在进行的那一轮；回合结束时还开着说明被停止或出错。 */
const openRounds = new Map<string, { traceId: string; startedAt: number }>()

const errorOf = (message: string): { message: string } => ({ message: message.slice(0, 4000) })
const EMPTY_USAGE: ModelStepUsage = { inputTokens: null, inputNoCacheTokens: null, cacheReadTokens: null, cacheWriteTokens: null, outputTokens: null, textTokens: null, reasoningTokens: null, totalTokens: null }

/** Pi 的 input 不含缓存读写；助手追踪的输入按总输入计。 */
function usageFrom(metrics: EngineLog['metrics']): ModelStepUsage {
  if (!metrics) return EMPTY_USAGE
  return { inputTokens: metrics.input + metrics.cacheRead + metrics.cacheWrite, inputNoCacheTokens: metrics.input,
    cacheReadTokens: metrics.cacheRead, cacheWriteTokens: metrics.cacheWrite, outputTokens: metrics.output,
    textTokens: null, reasoningTokens: metrics.reasoning ?? null, totalTokens: metrics.totalTokens }
}

/**
 * 内置助手每轮模型请求写进助手追踪（只存摘要），日志窗口“助手追踪”据此按运行列出；
 * 工具调用、事务与回复仍在同一 requestId 的日志事件里，两者用 runId = requestId 关联。
 * 追踪是诊断记录，写入失败只记日志，不打断回复。
 */
export function recordPiTrace(message: EngineLog, goal?: string): void {
  try {
    const store = getAgentTraceStore()
    const runId = message.requestId
    if (message.phase === 'start') {
      store.saveRunContext({ runId, threadId: message.sessionId, goal, status: 'running' })
    } else if (message.phase === 'model_requested' && message.providerId && message.modelId) {
      const turn = message.turn ?? 1
      const traceId = `${runId}:${turn}`
      openRounds.set(runId, { traceId, startedAt: Date.now() })
      store.start({ traceId, runId, requestId: runId, stepId: `turn-${turn}`, kind: runId.endsWith(':memory') ? 'other' : 'primary', turn,
        providerId: message.providerId, modelId: message.modelId, startedAt: new Date().toISOString(), captureMode: 'summary' })
    } else if (message.phase === 'model_completed') {
      const open = openRounds.get(runId)
      if (!open) return
      openRounds.delete(runId)
      const base = { traceId: open.traceId, completedAt: new Date().toISOString(), elapsedMs: message.durationMs ?? Math.max(0, Date.now() - open.startedAt), usage: usageFrom(message.metrics) }
      if (message.stopReason === 'error' || message.stopReason === 'aborted') {
        store.fail({ ...base, status: message.stopReason === 'error' ? 'failed' : 'cancelled', error: errorOf(message.message ?? (message.stopReason === 'error' ? '模型请求失败' : '已停止')) })
      } else store.complete({ ...base, ...(message.stopReason ? { finishReason: message.stopReason } : {}) })
    } else if (message.phase === 'completed' || message.phase === 'failed' || message.phase === 'cancelled') {
      const open = openRounds.get(runId)
      if (open) {
        openRounds.delete(runId)
        store.fail({ traceId: open.traceId, completedAt: new Date().toISOString(), elapsedMs: Math.max(0, Date.now() - open.startedAt), usage: EMPTY_USAGE,
          status: message.phase === 'failed' ? 'failed' : 'cancelled', error: errorOf(message.message ?? '本轮未返回') })
      }
      store.saveRunContext({ runId, status: message.phase })
    }
  } catch (error) {
    logger.warn('写入助手追踪失败', { event: 'embedded_agent.trace.failed', requestId: message.requestId, error })
  }
}

/**
 * 运行在回合结束事件之外结束（请求失败、助手进程退出、停止后被强制结束）：关掉还开着的那一轮并写运行状态；
 * 还没发出模型请求就失败（模型不可用、准备上下文出错）的运行也要出现在助手追踪里，记成一条“准备”步骤。
 */
export function recordPiRunEnded(runId: string, goal: string, model: { providerId: string; modelId: string }, status: 'failed' | 'cancelled', message: string): void {
  try {
    const store = getAgentTraceStore()
    store.saveRunContext({ runId, goal, status })
    const now = new Date().toISOString()
    const open = openRounds.get(runId)
    if (open) {
      openRounds.delete(runId)
      store.fail({ traceId: open.traceId, completedAt: now, elapsedMs: Math.max(0, Date.now() - open.startedAt), status, usage: EMPTY_USAGE, error: errorOf(message) })
    }
    if (status === 'cancelled' || store.query({ runId, limit: 1 }).runs.length) return
    const traceId = `${runId}:prepare`
    store.start({ traceId, runId, requestId: runId, stepId: 'prepare', kind: 'other', providerId: model.providerId, modelId: model.modelId, startedAt: now, captureMode: 'summary' })
    store.fail({ traceId, completedAt: now, elapsedMs: 0, status: 'failed', usage: EMPTY_USAGE, error: errorOf(message) })
  } catch (error) {
    logger.warn('写入助手追踪失败', { event: 'embedded_agent.trace.failed', requestId: runId, error })
  }
}
