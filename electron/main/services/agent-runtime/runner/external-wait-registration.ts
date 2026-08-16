import { randomUUID } from 'node:crypto'

import type { AgentEventInput, AgentRunStatus } from '../../../../../src/core/assistant/events'
import {
  AGENT_EXTERNAL_WAIT_VERSION,
  henjiScriptCheckpointSchema,
  type HenjiScriptCheckpoint,
  type AgentExternalWaitRecord,
  type AgentExternalWaitRegister,
} from '../../../../../src/core/assistant/externalWait'
import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import type { AgentTurnSnapshotDraft } from '../../../../../src/core/assistant/turn'
import type { AgentSavePointCoordinator } from './save-point-coordinator'

const DEFAULT_WAIT_TIMEOUT_MS = 60 * 60 * 1_000

interface SubmittedGeneration {
  taskId: string
  continuation: HenjiScriptCheckpoint | null
}

function findSubmittedGeneration(observations: AgentToolObservation[]): SubmittedGeneration | null {
  for (let index = observations.length - 1; index >= 0; index -= 1) {
    const observation = observations[index]
    if (!observation.output || typeof observation.output !== 'object') continue
    if (observation.source.toolName === 'run_henji_script') {
      const checkpoint = henjiScriptCheckpointSchema.safeParse(Reflect.get(observation.output, 'checkpoint'))
      const submittedTasks = Reflect.get(observation.output, 'submittedTasks')
      if (Array.isArray(submittedTasks)) {
        for (let taskIndex = submittedTasks.length - 1; taskIndex >= 0; taskIndex -= 1) {
          const task = submittedTasks[taskIndex]
          if (!task || typeof task !== 'object') continue
          const taskId = Reflect.get(task, 'taskId')
          const status = Reflect.get(task, 'status')
          if (typeof taskId === 'string' && status === 'submitted') {
            if (!checkpoint.success) {
              throw new Error('[HENJI_SCRIPT_CHECKPOINT_MISSING] 外部生成已提交，但脚本没有可续跑断点')
            }
            return { taskId, continuation: checkpoint.data }
          }
        }
      }
      continue
    }
    if (observation.source.toolName !== 'create_visible_generation_task') continue
    const taskId = Reflect.get(observation.output, 'taskId')
    const status = Reflect.get(observation.output, 'status')
    if (typeof taskId === 'string' && status === 'submitted') return { taskId, continuation: null }
  }
  return null
}

interface AgentExternalWaitRegistrationOptions {
  runId: string
  threadId: string
  savePoints: AgentSavePointCoordinator
  register?: (input: AgentExternalWaitRegister) => Promise<AgentExternalWaitRecord>
  transition: (status: AgentRunStatus, reason?: string) => void
  emit: (event: AgentEventInput) => void
  onWaiting?: () => void
}

export class AgentExternalWaitRegistration {
  constructor(private readonly options: AgentExternalWaitRegistrationOptions) {}

  async registerIfSubmitted(
    observations: AgentToolObservation[],
    snapshot: AgentTurnSnapshotDraft
  ): Promise<boolean> {
    const submitted = findSubmittedGeneration(observations)
    if (!submitted || !this.options.register) return false
    const waitId = randomUUID()
    this.options.transition('waiting_external', '生成任务已提交，等待权威终态')
    this.options.onWaiting?.()
    const savePoint = await this.options.savePoints.save('waiting_external', snapshot)
    const record = await this.options.register({
      version: AGENT_EXTERNAL_WAIT_VERSION,
      waitId,
      threadId: this.options.threadId,
      sourceRunId: this.options.runId,
      taskId: submitted.taskId,
      targetStatuses: ['success', 'error', 'cancelled'],
      timeoutMs: DEFAULT_WAIT_TIMEOUT_MS,
      savePointSequence: savePoint?.stateSequence ?? 0,
      resumePolicy: 'linked_child_once',
      continuation: submitted.continuation,
    })
    this.options.emit({
      type: 'ExternalWaitRegistered',
      waitId: record.waitId,
      taskId: record.taskId,
      expiresAt: record.expiresAt,
    })
    return true
  }
}
