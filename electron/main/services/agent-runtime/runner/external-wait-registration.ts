import { randomUUID } from 'node:crypto'

import type { AgentEventInput, AgentRunStatus } from '../../../../../src/core/assistant/events'
import {
  AGENT_EXTERNAL_WAIT_VERSION,
  type AgentExternalWaitRecord,
  type AgentExternalWaitRegister,
} from '../../../../../src/core/assistant/externalWait'
import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import type { AgentTurnSnapshotDraft } from '../../../../../src/core/assistant/turn'
import type { AgentSavePointCoordinator } from './save-point-coordinator'

const DEFAULT_WAIT_TIMEOUT_MS = 60 * 60 * 1_000

interface SubmittedGeneration {
  taskId: string
}

function findSubmittedGeneration(observations: AgentToolObservation[]): SubmittedGeneration | null {
  for (let index = observations.length - 1; index >= 0; index -= 1) {
    const observation = observations[index]
    if (observation.source.toolName !== 'create_visible_generation_task') continue
    if (!observation.output || typeof observation.output !== 'object') continue
    const taskId = Reflect.get(observation.output, 'taskId')
    const status = Reflect.get(observation.output, 'status')
    if (typeof taskId === 'string' && status === 'submitted') return { taskId }
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
