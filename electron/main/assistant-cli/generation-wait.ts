import type { AgentRunState } from '../../../src/core/assistant/events'
import type { ApplicationCapabilityResult } from '../../../src/core/assistant/hostContracts'
import type { AgentRunSummary } from '../../../src/core/assistant/persistence'
import {
  isGenerationTerminalStatus,
  normalizeGenerationTaskStatus,
} from '../../../src/core/assistant/externalWait'

export interface CliGenerationTaskObservation {
  taskId: string
  status: string
  progress: number | null
  errorCode: string | null
  errorMessage: string | null
  terminal: boolean
}

export interface CliGenerationWaitResult {
  status: 'completed' | 'failed' | 'timed_out' | 'skipped'
  tasks: CliGenerationTaskObservation[]
}

export interface CliExternalContinuationResult {
  status: 'completed' | 'timed_out' | 'skipped'
  runId: string
  state: AgentRunState
}

interface GenerationWaitInput {
  state: AgentRunState
  taskIds?: string[]
  timeoutMs: number
  observe: (taskId: string, attempt: number) => Promise<ApplicationCapabilityResult>
  onObservation: (observation: CliGenerationTaskObservation) => void
  pollIntervalMs?: number
  sleep?: (delayMs: number) => Promise<void>
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function stringField(record: Record<string, unknown> | null, field: string): string | null {
  const value = record?.[field]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function numberField(record: Record<string, unknown> | null, field: string): number | null {
  const value = record?.[field]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function taskIdsFromEvidence(evidence: string[]): string[] {
  return evidence.flatMap((item) => item.startsWith('taskId:')
    ? [item.slice('taskId:'.length)]
    : [])
}

export function extractSubmittedGenerationTaskIds(state: AgentRunState): string[] {
  const completedSteps = state.workingSummary?.completedSteps ?? []
  return [...new Set(completedSteps
    .filter((step) => step.toolName === 'create_visible_generation_task')
    .flatMap((step) => taskIdsFromEvidence(step.evidence))
    .filter((taskId) => taskId.length > 0))]
}

export function normalizeGenerationTaskObservation(
  taskId: string,
  result: ApplicationCapabilityResult
): CliGenerationTaskObservation {
  if (!result.ok) {
    return {
      taskId,
      status: 'unavailable',
      progress: null,
      errorCode: result.error.code,
      errorMessage: result.error.message,
      terminal: true,
    }
  }
  const task = asRecord(result.data.task)
  const status = stringField(task, 'status')?.toLowerCase() ?? 'unknown'
  return {
    taskId,
    status,
    progress: numberField(task, 'progress'),
    errorCode: stringField(task, 'errorCode'),
    errorMessage: stringField(task, 'errorMessage'),
    terminal: isGenerationTerminalStatus(status),
  }
}

function observationSignature(observation: CliGenerationTaskObservation): string {
  return [
    observation.status,
    observation.progress ?? '',
    observation.errorCode ?? '',
    observation.errorMessage ?? '',
  ].join('|')
}

function wait(delayMs: number): Promise<void> {
  return new Promise<void>((resolve) => { setTimeout(resolve, delayMs) })
}

export async function waitForSubmittedGenerationTasks(
  input: GenerationWaitInput
): Promise<CliGenerationWaitResult> {
  const taskIds = [...new Set([
    ...extractSubmittedGenerationTaskIds(input.state),
    ...(input.taskIds ?? []),
  ].filter((taskId) => taskId.length > 0))]
  if (taskIds.length === 0) return { status: 'skipped', tasks: [] }

  const deadline = Date.now() + Math.max(0, input.timeoutMs)
  const pollIntervalMs = Math.max(250, input.pollIntervalMs ?? 1_000)
  const sleep = input.sleep ?? wait
  const observations = new Map<string, CliGenerationTaskObservation>()
  const signatures = new Map<string, string>()
  let attempt = 0
  let shouldContinue = true

  while (shouldContinue) {
    attempt += 1
    for (const taskId of taskIds) {
      const observation = normalizeGenerationTaskObservation(taskId, await input.observe(taskId, attempt))
      observations.set(taskId, observation)
      const signature = observationSignature(observation)
      if (signatures.get(taskId) !== signature) {
        signatures.set(taskId, signature)
        input.onObservation(observation)
      }
    }

    const tasks = taskIds.map((taskId) => observations.get(taskId)).filter(
      (task): task is CliGenerationTaskObservation => task !== undefined
    )
    if (tasks.every((task) => task.terminal)) {
      return {
        status: tasks.every((task) => normalizeGenerationTaskStatus(task.status) === 'success')
          ? 'completed'
          : 'failed',
        tasks,
      }
    }
    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) {
      shouldContinue = false
      continue
    }
    await sleep(Math.min(pollIntervalMs, remainingMs))
  }

  return {
    status: 'timed_out',
    tasks: taskIds.map((taskId) => observations.get(taskId)).filter(
      (task): task is CliGenerationTaskObservation => task !== undefined
    ),
  }
}

export async function waitForExternalContinuation(input: {
  sourceRunId: string
  threadId: string
  sourceState: AgentRunState
  timeoutMs: number
  listRuns: (threadId: string) => AgentRunSummary[]
  getState: (runId: string) => AgentRunState
  pollIntervalMs?: number
  sleep?: (delayMs: number) => Promise<void>
}): Promise<CliExternalContinuationResult> {
  if (input.sourceState.status !== 'waiting_external') {
    return { status: 'skipped', runId: input.sourceRunId, state: input.sourceState }
  }
  const deadline = Date.now() + Math.max(0, input.timeoutMs)
  const pollIntervalMs = Math.max(100, input.pollIntervalMs ?? 250)
  const sleep = input.sleep ?? wait
  let currentRunId = input.sourceRunId
  let currentState = input.sourceState

  for (;;) {
    const children = input.listRuns(input.threadId)
      .filter((run) => run.parentRunId === currentRunId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    const child = children.at(-1)
    if (child) {
      currentRunId = child.runId
      currentState = input.getState(currentRunId)
      if (currentState.status !== 'waiting_external'
        && ['completed', 'completed_with_warning', 'budget_exhausted', 'failed', 'cancelled'].includes(currentState.status)) {
        return { status: 'completed', runId: currentRunId, state: currentState }
      }
    } else if (currentRunId !== input.sourceRunId) {
      currentState = input.getState(currentRunId)
      if (currentState.status !== 'waiting_external'
        && ['completed', 'completed_with_warning', 'budget_exhausted', 'failed', 'cancelled'].includes(currentState.status)) {
        return { status: 'completed', runId: currentRunId, state: currentState }
      }
    }

    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) {
      return { status: 'timed_out', runId: currentRunId, state: currentState }
    }
    await sleep(Math.min(pollIntervalMs, remainingMs))
  }
}
