import { randomUUID } from 'node:crypto'

import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import type { AgentContextArtifact } from './types'

const OFFLOAD_BYTE_THRESHOLD = 8 * 1024
const OFFLOAD_RECORD_THRESHOLD = 100

function recordCount(value: unknown): number {
  if (Array.isArray(value)) return value.length
  if (!value || typeof value !== 'object') return 0
  return Object.keys(value).length
}

export function shouldOffloadObservation(output: unknown): boolean {
  return Buffer.byteLength(JSON.stringify(output), 'utf8') > OFFLOAD_BYTE_THRESHOLD
    || recordCount(output) > OFFLOAD_RECORD_THRESHOLD
}

export class AgentArtifactStore {
  private readonly artifacts = new Map<string, AgentContextArtifact>()

  offload(observation: AgentToolObservation, payload: unknown): AgentContextArtifact {
    const artifact: AgentContextArtifact = {
      artifactRef: `artifact:${randomUUID()}`,
      source: `${observation.source.toolName}:${observation.source.toolCallId}`,
      dataClasses: observation.dataClasses,
      createdAt: new Date().toISOString(),
      originalBytes: Buffer.byteLength(JSON.stringify(payload), 'utf8'),
      payload,
    }
    this.artifacts.set(artifact.artifactRef, artifact)
    return artifact
  }

  get(artifactRef: string): AgentContextArtifact | null {
    return this.artifacts.get(artifactRef) ?? null
  }

  deleteRunArtifacts(artifactRefs: string[]): void {
    for (const artifactRef of artifactRefs) this.artifacts.delete(artifactRef)
  }
}
