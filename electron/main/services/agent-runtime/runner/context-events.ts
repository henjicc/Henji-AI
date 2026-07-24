import type { AgentEventInput } from '../../../../../src/core/assistant/events'
import type { AgentContextBuilder } from '../context/builder'

export function emitAgentContextEvents(
  turn: number,
  context: ReturnType<AgentContextBuilder['build']>,
  summaryVersion: string | undefined,
  emit: (event: AgentEventInput) => void
): void {
  emit({
    type: 'ContextUpdated',
    turn,
    snapshotRevision: context.snapshotRevision,
    activeToolNames: context.activeToolNames,
    estimatedTokens: context.estimatedTokens,
  })
  if (context.compacted) {
    emit({
      type: 'ContextCompacted',
      beforeTokens: context.beforeCompactionTokens,
      afterTokens: context.estimatedTokens,
      reason: context.compactionReason ?? '上下文超过预算',
      retainedLayers: context.retainedLayers,
      droppedLayers: context.droppedLayers,
      summaryVersion,
    })
  }
  for (const artifact of context.offloaded) {
    emit({
      type: 'ArtifactOffloaded',
      artifactRef: artifact.artifactRef,
      source: artifact.source,
      originalBytes: artifact.originalBytes,
    })
  }
}
