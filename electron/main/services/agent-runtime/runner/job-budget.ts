import type { AgentBudgetConfig, AgentRunState } from '../../../../../src/core/assistant/events'

import { DEFAULT_AGENT_BUDGET } from './budget'

export const AGENT_JOB_HARD_BUDGET = {
  runs: 3,
  turns: 96,
  toolCalls: 200,
  writeToolCalls: 48,
  durationMs: 60 * 60 * 1_000,
  knownCostUsd: 10,
} as const

export interface AgentJobBudgetDecision {
  allowed: boolean
  budget?: Partial<AgentBudgetConfig>
  reason?: string
}

function bounded(current: number | null | undefined, fallback: number, remaining: number): number {
  return Math.max(0, Math.min(current ?? fallback, remaining))
}

export function decideAgentBudgetContinuation(
  states: AgentRunState[],
  nextSegment: number,
  requested: Partial<AgentBudgetConfig> | undefined,
  now = Date.now()
): AgentJobBudgetDecision {
  if (nextSegment > AGENT_JOB_HARD_BUDGET.runs || states.length >= AGENT_JOB_HARD_BUDGET.runs) {
    return { allowed: false, reason: '已达到最多 3 段运行' }
  }
  const usage = states.reduce((total, state) => ({
    turns: total.turns + state.usage.turns,
    toolCalls: total.toolCalls + state.usage.toolCalls,
    writeToolCalls: total.writeToolCalls + state.usage.writeToolCalls,
    knownCostUsd: total.knownCostUsd + (state.usage.knownCostUsd ?? 0),
  }), { turns: 0, toolCalls: 0, writeToolCalls: 0, knownCostUsd: 0 })
  const startedAt = Math.min(...states.map((state) => Date.parse(state.startedAt)))
  const elapsedMs = Number.isFinite(startedAt) ? Math.max(0, now - startedAt) : 0
  const remaining = {
    turns: AGENT_JOB_HARD_BUDGET.turns - usage.turns,
    toolCalls: AGENT_JOB_HARD_BUDGET.toolCalls - usage.toolCalls,
    writeToolCalls: AGENT_JOB_HARD_BUDGET.writeToolCalls - usage.writeToolCalls,
    durationMs: AGENT_JOB_HARD_BUDGET.durationMs - elapsedMs,
    knownCostUsd: AGENT_JOB_HARD_BUDGET.knownCostUsd - usage.knownCostUsd,
  }
  if (Object.values(remaining).some((value) => value <= 0)) {
    return { allowed: false, reason: 'Job 累计预算已耗尽' }
  }
  const maxTurns = bounded(requested?.maxTurns, DEFAULT_AGENT_BUDGET.maxTurns ?? 32, remaining.turns)
  const maxToolCalls = bounded(
        requested?.maxToolCalls,
        DEFAULT_AGENT_BUDGET.maxToolCalls ?? 100,
        remaining.toolCalls
      )
  const maxWriteToolCalls = bounded(
        requested?.maxWriteToolCalls,
        DEFAULT_AGENT_BUDGET.maxWriteToolCalls ?? 24,
        remaining.writeToolCalls
      )
  const maxDurationMs = bounded(
        requested?.maxDurationMs,
        DEFAULT_AGENT_BUDGET.maxDurationMs ?? 30 * 60 * 1_000,
        remaining.durationMs
      )
  const maxCostUsd = Math.min(
        requested?.maxCostUsd ?? DEFAULT_AGENT_BUDGET.maxCostUsd ?? 10,
        remaining.knownCostUsd
      )
  return {
    allowed: true,
    budget: {
      ...requested,
      softMaxTurns: Math.min(requested?.softMaxTurns ?? DEFAULT_AGENT_BUDGET.softMaxTurns ?? 20, maxTurns),
      maxTurns,
      softMaxToolCalls: Math.min(requested?.softMaxToolCalls ?? DEFAULT_AGENT_BUDGET.softMaxToolCalls ?? 50, maxToolCalls),
      maxToolCalls,
      softMaxWriteToolCalls: Math.min(
        requested?.softMaxWriteToolCalls ?? DEFAULT_AGENT_BUDGET.softMaxWriteToolCalls ?? 12,
        maxWriteToolCalls
      ),
      maxWriteToolCalls,
      maxDurationMs,
      softMaxCostUsd: Math.min(
        requested?.softMaxCostUsd ?? DEFAULT_AGENT_BUDGET.softMaxCostUsd ?? 3,
        maxCostUsd
      ),
      maxCostUsd,
    },
  }
}
