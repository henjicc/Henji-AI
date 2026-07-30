import {
  AGENT_SAVE_POINT_VERSION,
  type AgentSavePoint,
  type AgentSavePointStage,
  type AgentTurnSnapshotDraft,
} from '../../../../../src/core/assistant/turn'
import type { AgentRunState, AgentEventInput } from '../../../../../src/core/assistant/events'
import type { AgentRunnerDependencies } from './types'

interface AgentSavePointCoordinatorOptions {
  append?: AgentRunnerDependencies['appendSavePoint']
  getState: () => AgentRunState
  emit: (event: AgentEventInput) => void
}

export class AgentSavePointCoordinator {
  constructor(private readonly options: AgentSavePointCoordinatorOptions) {}

  async save(
    stage: Exclude<AgentSavePointStage, 'settled'>,
    snapshot: AgentTurnSnapshotDraft
  ): Promise<AgentSavePoint | null> {
    if (!this.options.append) return null
    const saved = await this.options.append({
      version: AGENT_SAVE_POINT_VERSION,
      stage,
      snapshot,
      state: this.options.getState(),
      idempotencyKey: `${stage}:${snapshot.runId}:${snapshot.turn}`,
    })
    this.options.emit({
      type: 'SavePointCreated',
      turn: snapshot.turn,
      stage,
      sessionHeadSequence: saved.snapshot.sessionHeadSequence,
      snapshotVersion: saved.snapshot.version,
    })
    return saved
  }
}
