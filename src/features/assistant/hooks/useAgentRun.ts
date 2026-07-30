import { useCallback, useEffect, useReducer, useRef, useState } from 'react'

import {
  cancelAgentRun,
  getAgentRunEvents,
  getAgentRunSnapshot,
  getAgentRunState,
  onAgentEvent,
  pauseAgentRun,
  respondAgentApproval,
  resumeAgentRun,
  startAgentRun,
  enqueueAgentMessage,
  cancelQueuedAgentMessage,
} from '@/commands/assistant'
import type { AgentApprovalResponse } from '@/core/assistant/runtimeContracts'
import type { AgentEvent } from '@/core/assistant/events'
import type { AgentQueuedMessagePayload } from '@/core/assistant/session'
import { createLogger } from '@/core/logging'
import { llmConfigService } from '@/services/llm/LlmConfigService'

import {
  agentRunViewReducer,
  createInitialAgentRunViewState,
  type AgentRunViewState,
} from '../conversation/agentRunReducer'
import { useAssistantUiStore } from '../store/assistantUiStore'
import {
  collectContiguousAgentEvents,
  deriveAgentSnapshotRecoveryBaseline,
  mergeAgentEventReplay,
} from './agentEventRecovery'

const logger = createLogger('features.assistant.ui')

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '智能助手操作失败'
}

export interface UseAgentRunResult {
  view: AgentRunViewState
  submitting: boolean
  start: (goal: string) => Promise<boolean>
  enqueue: (
    content: string,
    mode: AgentQueuedMessagePayload['mode'],
    waitId?: string
  ) => Promise<boolean>
  cancelQueued: (entryId: string) => Promise<void>
  queueRevision: number
  cancel: () => Promise<void>
  pause: () => Promise<void>
  resume: () => Promise<void>
  respondApproval: (approvalId: string, decision: AgentApprovalResponse['decision']) => Promise<void>
  refresh: () => Promise<void>
  clearActionError: () => void
}

export function useAgentRun(): UseAgentRunResult {
  const [view, dispatch] = useReducer(agentRunViewReducer, undefined, createInitialAgentRunViewState)
  const [submitting, setSubmitting] = useState(false)
  const [queueRevision, setQueueRevision] = useState(0)
  const activeRunId = useAssistantUiStore((state) => state.activeRunId)
  const threadId = useAssistantUiStore((state) => state.threadId)
  const approvalMode = useAssistantUiStore((state) => state.approvalMode)
  const activeRunIdRef = useRef(activeRunId)
  const threadIdRef = useRef(threadId)
  const previousActiveRunIdRef = useRef(activeRunId)
  const hydratedRunIdRef = useRef<string | null>(null)
  const bufferedEventsRef = useRef(new Map<string, AgentEvent[]>())
  const coveredSequenceRef = useRef(new Map<string, number>())
  const recoveryInFlightRef = useRef(new Set<string>())
  const recoverAgentEventGapRef = useRef<(runId: string) => Promise<void>>(async () => undefined)
  const refreshEpochRef = useRef(0)
  const pendingViewEventsRef = useRef<AgentEvent[]>([])
  const viewFrameRef = useRef<number | null>(null)
  if (previousActiveRunIdRef.current !== activeRunId) {
    previousActiveRunIdRef.current = activeRunId
    hydratedRunIdRef.current = null
  }
  activeRunIdRef.current = activeRunId
  threadIdRef.current = threadId

  const queueViewEvent = useCallback((event: AgentEvent): void => {
    pendingViewEventsRef.current.push(event)
    if (viewFrameRef.current !== null) return
    viewFrameRef.current = window.requestAnimationFrame(() => {
      viewFrameRef.current = null
      const events = pendingViewEventsRef.current
      pendingViewEventsRef.current = []
      if (events.length > 0) dispatch({ type: 'events', events })
    })
  }, [])

  const bufferRunEvent = useCallback((runId: string, event: AgentEvent): void => {
    const pending = bufferedEventsRef.current.get(runId) ?? []
    pending.push(event)
    bufferedEventsRef.current.set(runId, pending.slice(-2_000))
    while (bufferedEventsRef.current.size > 3) {
      const oldest = bufferedEventsRef.current.keys().next().value
      if (typeof oldest === 'string') bufferedEventsRef.current.delete(oldest)
    }
  }, [])

  const consumeBufferedEvents = useCallback((runId: string): boolean => {
    const afterSequence = coveredSequenceRef.current.get(runId)
    if (afterSequence === undefined) return false
    const pending = bufferedEventsRef.current.get(runId) ?? []
    const batch = collectContiguousAgentEvents(afterSequence, pending)
    if (batch.events.length > 0 && activeRunIdRef.current === runId) {
      for (const event of batch.events) queueViewEvent(event)
    }
    coveredSequenceRef.current.set(runId, batch.coveredThroughSequence)
    const remaining = pending.filter((event) => event.sequence > batch.coveredThroughSequence)
    if (remaining.length > 0) bufferedEventsRef.current.set(runId, remaining)
    else bufferedEventsRef.current.delete(runId)
    return batch.hasGap
  }, [queueViewEvent])

  const recoverAgentEventGap = useCallback(async (runId: string): Promise<void> => {
    if (recoveryInFlightRef.current.has(runId)) return
    recoveryInFlightRef.current.add(runId)
    if (activeRunIdRef.current === runId) {
      dispatch({ type: 'connection', connection: 'recovering' })
    }
    logger.warn('智能助手事件流检测到缺口，开始增量补拉', {
      event: 'assistant_ui.run.events.recovery.start',
      requestId: runId,
      context: { afterSequence: coveredSequenceRef.current.get(runId) ?? 0 },
    })
    let recoveryCompleted = false
    try {
      let attempts = 0
      while (activeRunIdRef.current === runId && attempts < 50) {
        attempts += 1
        const afterSequence = coveredSequenceRef.current.get(runId) ?? 0
        const page = await getAgentRunEvents(runId, afterSequence, 2_000)
        if (activeRunIdRef.current !== runId) return
        if (page.hasGap) {
          const snapshot = await getAgentRunSnapshot(runId)
          if (activeRunIdRef.current !== runId) return
          dispatch({ type: 'hydrate', snapshot })
          hydratedRunIdRef.current = runId
          coveredSequenceRef.current.set(
            runId,
            snapshot.state.sequence
          )
          consumeBufferedEvents(runId)
          logger.warn('智能助手事件缺口无法增量补齐，已回退整份快照', {
            event: 'assistant_ui.run.events.recovery.snapshot_fallback',
            requestId: runId,
            context: {
              afterSequence,
              oldestSequence: page.oldestSequence,
              latestSequence: page.latestSequence,
            },
          })
          break
        }
        const pending = bufferedEventsRef.current.get(runId) ?? []
        bufferedEventsRef.current.set(runId, mergeAgentEventReplay(pending, page.events))
        const stillHasGap = consumeBufferedEvents(runId)
        if (!page.hasMore && !stillHasGap) break
        if (page.coveredThroughSequence <= afterSequence && page.events.length === 0) {
          throw new Error('增量事件补拉没有推进游标')
        }
      }
      if (consumeBufferedEvents(runId)) {
        throw new Error('增量事件补拉达到安全页数后仍存在缺口')
      }
      if (activeRunIdRef.current === runId) {
        dispatch({ type: 'connection', connection: 'connected' })
      }
      logger.info('智能助手事件流增量补拉完成', {
        event: 'assistant_ui.run.events.recovery.completed',
        requestId: runId,
        context: { coveredThroughSequence: coveredSequenceRef.current.get(runId) ?? 0 },
      })
      recoveryCompleted = true
    } catch (error) {
      if (activeRunIdRef.current === runId) {
        dispatch({ type: 'connection', connection: 'disconnected' })
        dispatch({ type: 'action_error', message: '事件流恢复失败，可点击重试重新连接。' })
      }
      logger.error('智能助手事件流增量补拉失败', error, {
        event: 'assistant_ui.run.events.recovery.failed',
        requestId: runId,
      })
    } finally {
      recoveryInFlightRef.current.delete(runId)
      if (
        recoveryCompleted
        && activeRunIdRef.current === runId
        && hydratedRunIdRef.current === runId
        && consumeBufferedEvents(runId)
      ) {
        window.setTimeout(() => {
          void recoverAgentEventGapRef.current(runId)
        }, 0)
      }
    }
  }, [consumeBufferedEvents])
  recoverAgentEventGapRef.current = recoverAgentEventGap

  useEffect(() => {
    const unsubscribe = onAgentEvent((payload) => {
      if (
        payload.event.type === 'RunStarted'
        && payload.event.threadId === threadIdRef.current
        && activeRunIdRef.current !== payload.runId
      ) {
        activeRunIdRef.current = payload.runId
        useAssistantUiStore.getState().setActiveRun(
          payload.runId,
          payload.event.goal ?? '继续处理排队消息'
        )
      }
      const currentRunId = activeRunIdRef.current
      bufferRunEvent(payload.runId, payload.event)
      if (currentRunId === payload.runId && hydratedRunIdRef.current === payload.runId) {
        const hasGap = consumeBufferedEvents(payload.runId)
        if (hasGap) void recoverAgentEventGap(payload.runId)
        return
      }
    })
    return () => {
      unsubscribe()
      if (viewFrameRef.current !== null) window.cancelAnimationFrame(viewFrameRef.current)
      viewFrameRef.current = null
      pendingViewEventsRef.current = []
    }
  }, [bufferRunEvent, consumeBufferedEvents, recoverAgentEventGap])

  const refresh = useCallback(async (): Promise<void> => {
    const runId = activeRunIdRef.current
    if (!runId) return
    const refreshEpoch = refreshEpochRef.current + 1
    refreshEpochRef.current = refreshEpoch
    hydratedRunIdRef.current = null
    dispatch({ type: 'connection', connection: 'recovering' })
    let lastError: unknown
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const snapshot = await getAgentRunSnapshot(runId)
        if (
          activeRunIdRef.current !== runId
          || refreshEpochRef.current !== refreshEpoch
        ) return
        dispatch({ type: 'hydrate', snapshot })
        hydratedRunIdRef.current = runId
        const baseline = deriveAgentSnapshotRecoveryBaseline(
          snapshot.state.sequence,
          snapshot.events
        )
        coveredSequenceRef.current.set(runId, baseline.coveredThroughSequence)
        const hasGap = consumeBufferedEvents(runId)
        if (hasGap || baseline.requiresCatchUp) {
          void recoverAgentEventGap(runId)
        } else {
          dispatch({ type: 'connection', connection: 'connected' })
        }
        return
      } catch (error) {
        lastError = error
        if (attempt < 2) await new Promise<void>((resolve) => window.setTimeout(resolve, 250))
      }
    }
    if (activeRunIdRef.current !== runId || refreshEpochRef.current !== refreshEpoch) return
    dispatch({ type: 'connection', connection: 'disconnected' })
    dispatch({ type: 'action_error', message: '无法读取这条运行记录；它可能已被删除或数据库暂时不可用。' })
    logger.warn('智能助手运行恢复失败', {
      event: 'assistant_ui.run.restore.failed',
      requestId: runId,
      context: { errorCode: lastError instanceof Error ? lastError.name : 'UNKNOWN' },
    })
  }, [consumeBufferedEvents, recoverAgentEventGap])

  useEffect(() => {
    if (activeRunId) void refresh()
  }, [activeRunId, refresh])

  const start = useCallback(async (goal: string): Promise<boolean> => {
    const normalizedGoal = goal.trim()
    if (!normalizedGoal || submitting) return false
    setSubmitting(true)
    dispatch({ type: 'action_error', message: null })
    try {
      const config = await llmConfigService.getConfig()
      const profile = config.agentProfiles.find((item) => item.id === config.selectedAgentProfileId)
        ?? config.agentProfiles[0]
      if (!profile) throw new Error('尚未配置智能助手模型档案')
      const providers = new Map(config.providers.map((provider) => [provider.providerId, provider]))
      const models = config.models.map((model) => ({
        ...model,
        enabled: model.enabled && providers.get(model.providerId)?.enabled !== false,
        reasoning: providers.get(model.providerId)?.reasoning,
      }))
      logger.info('智能助手 UI 发起运行', {
        event: 'assistant_ui.run.start',
        context: { threadId, goalLength: normalizedGoal.length, profileId: profile.id },
      })
      const result = await startAgentRun({
        threadId,
        goal: normalizedGoal,
        profile,
        models,
        approvalMode,
      })
      activeRunIdRef.current = result.runId
      useAssistantUiStore.getState().setActiveRun(result.runId, normalizedGoal)
      dispatch({ type: 'begin', state: result.state })
      hydratedRunIdRef.current = result.runId
      coveredSequenceRef.current.set(result.runId, 0)
      const hasGap = consumeBufferedEvents(result.runId)
      if (hasGap || (coveredSequenceRef.current.get(result.runId) ?? 0) < result.state.sequence) {
        void recoverAgentEventGap(result.runId)
      }
      logger.info('智能助手 UI 运行已启动', {
        event: 'assistant_ui.run.start.completed',
        requestId: result.runId,
        context: { threadId, profileId: profile.id },
      })
      return true
    } catch (error) {
      const message = safeErrorMessage(error)
      dispatch({ type: 'action_error', message })
      logger.error('智能助手 UI 发起运行失败', error, {
        event: 'assistant_ui.run.start.failed',
        context: { threadId },
      })
      return false
    } finally {
      setSubmitting(false)
    }
  }, [approvalMode, consumeBufferedEvents, recoverAgentEventGap, submitting, threadId])

  const enqueue = useCallback(async (
    content: string,
    mode: AgentQueuedMessagePayload['mode'],
    waitId?: string
  ): Promise<boolean> => {
    const runId = activeRunIdRef.current
    const normalized = content.trim()
    if (!runId || !normalized || submitting) return false
    setSubmitting(true)
    try {
      await enqueueAgentMessage({
        threadId,
        runId,
        clientMessageId: crypto.randomUUID(),
        content: normalized,
        mode,
        waitId,
      })
      setQueueRevision((revision) => revision + 1)
      return true
    } catch (error) {
      dispatch({ type: 'action_error', message: safeErrorMessage(error) })
      return false
    } finally {
      setSubmitting(false)
    }
  }, [submitting, threadId])

  const cancelQueued = useCallback(async (entryId: string): Promise<void> => {
    const runId = activeRunIdRef.current
    if (!runId) return
    try {
      await cancelQueuedAgentMessage({ threadId, runId, entryId })
      setQueueRevision((revision) => revision + 1)
    } catch (error) {
      dispatch({ type: 'action_error', message: safeErrorMessage(error) })
    }
  }, [threadId])

  const control = useCallback(async (
    action: 'cancel' | 'pause' | 'resume',
    invoke: (runId: string) => ReturnType<typeof getAgentRunState>
  ): Promise<void> => {
    const runId = activeRunIdRef.current
    if (!runId) return
    dispatch({ type: 'action_error', message: null })
    try {
      logger.info(`智能助手 UI ${action}`, {
        event: `assistant_ui.run.${action}.start`,
        requestId: runId,
      })
      dispatch({ type: 'sync_state', state: await invoke(runId) })
    } catch (error) {
      dispatch({ type: 'action_error', message: safeErrorMessage(error) })
      logger.error(`智能助手 UI ${action} 失败`, error, {
        event: `assistant_ui.run.${action}.failed`,
        requestId: runId,
      })
    }
  }, [])

  const cancel = useCallback(() => control('cancel', (runId) => cancelAgentRun(runId)), [control])
  const pause = useCallback(() => control('pause', (runId) => pauseAgentRun(runId)), [control])
  const resume = useCallback(() => control('resume', (runId) => resumeAgentRun(runId)), [control])

  const respondApproval = useCallback(async (
    approvalId: string,
    decision: AgentApprovalResponse['decision']
  ): Promise<void> => {
    const runId = activeRunIdRef.current
    if (!runId) return
    dispatch({ type: 'action_error', message: null })
    try {
      logger.info('智能助手审批决定开始', {
        event: 'assistant_ui.approval.decision.start',
        requestId: runId,
        context: { approvalId, decision },
      })
      dispatch({ type: 'sync_state', state: await respondAgentApproval(runId, approvalId, decision) })
      logger.info('智能助手审批决定完成', {
        event: 'assistant_ui.approval.decision.completed',
        requestId: runId,
        context: { approvalId, decision },
      })
    } catch (error) {
      dispatch({ type: 'action_error', message: safeErrorMessage(error) })
      logger.error('智能助手审批决定失败', error, {
        event: 'assistant_ui.approval.decision.failed',
        requestId: runId,
        context: { approvalId, decision },
      })
    }
  }, [])

  return {
    view,
    submitting,
    queueRevision,
    start,
    enqueue,
    cancelQueued,
    cancel,
    pause,
    resume,
    respondApproval,
    refresh,
    clearActionError: () => dispatch({ type: 'action_error', message: null }),
  }
}
