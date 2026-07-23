import { useCallback, useEffect, useReducer, useRef, useState } from 'react'

import {
  cancelAgentRun,
  getAssistantModelPreferences,
  getAgentRunSnapshot,
  getAgentRunState,
  onAgentEvent,
  pauseAgentRun,
  respondAgentApproval,
  resumeAgentRun,
  startAgentRun,
} from '@/commands/assistant'
import type { AgentApprovalResponse } from '@/core/assistant/runtimeContracts'
import type { AgentEvent } from '@/core/assistant/events'
import { formatAssistantModelPreferencesForPrompt } from '@/core/assistant/modelPreferences'
import { createLogger } from '@/core/logging'
import { llmConfigService } from '@/services/llm/LlmConfigService'

import {
  agentRunViewReducer,
  createInitialAgentRunViewState,
  type AgentRunViewState,
} from '../conversation/agentRunReducer'
import { useAssistantUiStore } from '../store/assistantUiStore'

const logger = createLogger('features.assistant.ui')

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '智能助手操作失败'
}

export interface UseAgentRunResult {
  view: AgentRunViewState
  submitting: boolean
  start: (goal: string) => Promise<boolean>
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
  const activeRunId = useAssistantUiStore((state) => state.activeRunId)
  const threadId = useAssistantUiStore((state) => state.threadId)
  const activeRunIdRef = useRef(activeRunId)
  const bufferedEventsRef = useRef(new Map<string, AgentEvent[]>())
  activeRunIdRef.current = activeRunId

  useEffect(() => onAgentEvent((payload) => {
    const currentRunId = activeRunIdRef.current
    if (currentRunId === payload.runId) {
      dispatch({ type: 'event', event: payload.event })
      return
    }
    const pending = bufferedEventsRef.current.get(payload.runId) ?? []
    pending.push(payload.event)
    bufferedEventsRef.current.set(payload.runId, pending.slice(-200))
    while (bufferedEventsRef.current.size > 3) {
      const oldest = bufferedEventsRef.current.keys().next().value
      if (typeof oldest === 'string') bufferedEventsRef.current.delete(oldest)
    }
  }), [])

  const refresh = useCallback(async (): Promise<void> => {
    const runId = activeRunIdRef.current
    if (!runId) return
    dispatch({ type: 'connection', connection: 'recovering' })
    let lastError: unknown
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const snapshot = await getAgentRunSnapshot(runId)
        dispatch({ type: 'hydrate', snapshot })
        const buffered = bufferedEventsRef.current.get(runId) ?? []
        bufferedEventsRef.current.delete(runId)
        for (const event of buffered) dispatch({ type: 'event', event })
        return
      } catch (error) {
        lastError = error
        if (attempt < 2) await new Promise<void>((resolve) => window.setTimeout(resolve, 250))
      }
    }
    useAssistantUiStore.getState().setActiveRun(null)
    activeRunIdRef.current = null
    dispatch({ type: 'connection', connection: 'disconnected' })
    dispatch({ type: 'action_error', message: '上次运行已不可恢复；运行状态持久化将在后续阶段提供。' })
    logger.warn('智能助手运行恢复失败', {
      event: 'assistant_ui.run.restore.failed',
      requestId: runId,
      context: { errorCode: lastError instanceof Error ? lastError.name : 'UNKNOWN' },
    })
  }, [])

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
      const modelPreferences = await getAssistantModelPreferences()
      const profile = config.agentProfiles.find((item) => item.id === config.selectedAgentProfileId)
        ?? config.agentProfiles[0]
      if (!profile) throw new Error('尚未配置智能助手模型档案')
      const providerEnabled = new Map(config.providers.map((provider) => [provider.providerId, provider.enabled]))
      const models = config.models.map((model) => ({
        ...model,
        enabled: model.enabled && providerEnabled.get(model.providerId) !== false,
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
        userPreferences: formatAssistantModelPreferencesForPrompt(modelPreferences),
      })
      activeRunIdRef.current = result.runId
      useAssistantUiStore.getState().setActiveRun(result.runId, normalizedGoal)
      dispatch({ type: 'begin', state: result.state })
      const buffered = bufferedEventsRef.current.get(result.runId) ?? []
      bufferedEventsRef.current.delete(result.runId)
      for (const event of buffered) dispatch({ type: 'event', event })
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
  }, [submitting, threadId])

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
    start,
    cancel,
    pause,
    resume,
    respondApproval,
    refresh,
    clearActionError: () => dispatch({ type: 'action_error', message: null }),
  }
}
