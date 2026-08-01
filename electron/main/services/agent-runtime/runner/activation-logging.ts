import { createMainLogger } from '../../logging'
import type { AgentToolActivationSnapshot } from '../context/tool-activation'

const logger = createMainLogger('main.agent_runtime')

export function logAgentToolActivation(
  runId: string,
  turn: number,
  snapshotRevision: number,
  activation: AgentToolActivationSnapshot
): void {
  logger.info('Agent 本轮工具集合已冻结', {
    event: 'agent_catalog.activation.completed',
    requestId: runId,
    context: {
      turn,
      snapshotRevision,
      activeToolNames: activation.activeToolNames,
      pinnedToolNames: activation.pinnedToolNames,
      droppedPinnedToolNames: activation.droppedPinnedToolNames,
      schemaBytes: activation.schemaBytes,
      candidateCount: activation.candidateCount,
      droppedForCount: activation.droppedForCount,
      droppedForSchemaBudget: activation.droppedForSchemaBudget,
      unavailableNames: activation.unavailableNames,
    },
  })
}
