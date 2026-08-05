import { randomUUID } from 'node:crypto'

import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import type { AgentContextArtifact } from './types'

const OFFLOAD_BYTE_THRESHOLD = 8 * 1024
const OFFLOAD_RECORD_THRESHOLD = 400
/** 卸载门槛的绝对上限：再大的单条结果也该分页，否则一次压缩就把整段历史冲掉。 */
const OFFLOAD_BYTE_CEILING = 512 * 1024
/** 单条工具结果最多占用上下文窗口的比例。 */
const OFFLOAD_CONTEXT_SHARE = 0.15
/** 估算用：CJK 为主的结构化 JSON，1 token 约 2 字节。 */
const BYTES_PER_TOKEN = 2

/**
 * 卸载门槛必须跟随本轮真实上下文预算。
 *
 * 固定 8KB 是在小窗口模型时代定的。实测一次三维任务用的是 100 万窗口、峰值只占 3%，却把
 * 80KB 的实体结构文档推去做 4KB 分页——模型花了 20 轮把自己刚拿到的数据一页页读回来，
 * 期间还两次从头重读。上下文空着 97%，这纯粹是自伤。
 */
export function resolveOffloadByteThreshold(contextWindow: number | null | undefined): number {
  if (!contextWindow || !Number.isFinite(contextWindow) || contextWindow <= 0) {
    return OFFLOAD_BYTE_THRESHOLD
  }
  return Math.min(
    OFFLOAD_BYTE_CEILING,
    Math.max(OFFLOAD_BYTE_THRESHOLD, Math.floor(contextWindow * OFFLOAD_CONTEXT_SHARE * BYTES_PER_TOKEN))
  )
}

function recordCount(value: unknown): number {
  if (Array.isArray(value)) return value.length
  if (!value || typeof value !== 'object') return 0
  return Object.keys(value).length
}

/**
 * 条数门槛必须和字节门槛同步放大。
 *
 * 字节门槛改成跟上下文窗口走之后，这里的 400 条被落下了：一份 401 条、总共十几 KB 的清单，
 * 在 100 万窗口下照样被推去分页——字节判定说"随便放"，条数判定说"太大了"，两把尺子打架，
 * 而分页那条路径已经被实测证明是最贵的。放大倍数与字节门槛同比例，下限仍是 400。
 */
export function resolveOffloadRecordThreshold(byteThreshold: number): number {
  return Math.max(
    OFFLOAD_RECORD_THRESHOLD,
    Math.floor(OFFLOAD_RECORD_THRESHOLD * (byteThreshold / OFFLOAD_BYTE_THRESHOLD))
  )
}

export function shouldOffloadObservation(
  output: unknown,
  byteThreshold = OFFLOAD_BYTE_THRESHOLD
): boolean {
  return Buffer.byteLength(JSON.stringify(output), 'utf8') > byteThreshold
    || recordCount(output) > resolveOffloadRecordThreshold(byteThreshold)
}

interface AgentArtifactPersistence {
  save: (runId: string, artifact: AgentContextArtifact) => void
  load?: (artifactRef: string) => AgentContextArtifact | null
}

export class AgentArtifactStore {
  private readonly artifacts = new Map<string, AgentContextArtifact>()

  constructor(private readonly persistence?: AgentArtifactPersistence) {}

  offload(runId: string, observation: AgentToolObservation, payload: unknown): AgentContextArtifact {
    const artifact: AgentContextArtifact = {
      artifactRef: `artifact:${randomUUID()}`,
      source: `${observation.source.toolName}:${observation.source.toolCallId}`,
      dataClasses: observation.dataClasses,
      createdAt: new Date().toISOString(),
      originalBytes: Buffer.byteLength(JSON.stringify(payload), 'utf8'),
      payload,
    }
    this.artifacts.set(artifact.artifactRef, artifact)
    this.persistence?.save(runId, artifact)
    return artifact
  }

  get(artifactRef: string): AgentContextArtifact | null {
    return this.artifacts.get(artifactRef) ?? this.persistence?.load?.(artifactRef) ?? null
  }

  deleteRunArtifacts(artifactRefs: string[]): void {
    for (const artifactRef of artifactRefs) this.artifacts.delete(artifactRef)
  }
}
