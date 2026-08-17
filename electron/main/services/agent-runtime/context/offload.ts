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

/**
 * 有些工具的结果模型**必然要全量看**，分页只会平白多出几轮回读，一个字节也省不下来。
 *
 * `discover_application_capabilities` 是最典型的一个：它返回的不是"可以扫一眼的观察结果"，
 * 而是模型写任何一段脚本都必须完整持有的 scriptApi 契约。实测 camera 场景 66KB 的发现结果
 * 被推去分页，模型用 3 个回合把它一字不落地读回来（32768+32768+12550＝原始大小），
 * 这三页照样全部留在上下文里——卸载只换来了 3 个回合的净损失。
 *
 * 下限是**上限的下限**：真的超大结果仍然会分页，这里只保证常规体量一次到位。
 */
const INLINE_FLOOR_BY_TOOL: Readonly<Record<string, number>> = {
  search_models: 24 * 1024,
  discover_application_capabilities: 64 * 1024,
}

/**
 * 按工具名解析卸载门槛。**观察层与 tool 消息层必须共用这一个函数。**
 *
 * 之前 search_models 的 24KiB 下限只加在 runner-results.toolMessage 里，观察层还用着通用门槛，
 * 于是同一份结果在 tool 消息里内联、在观察层却被卸载成 artifact——这正是 prompt-layers 里
 * 那段注释警告过的"两把尺子"，只是当时补的是 contextWindow 和投影，漏了按工具的下限。
 */
export function resolveToolOffloadByteThreshold(
  toolName: string,
  contextWindow: number | null | undefined
): number {
  const resolved = resolveOffloadByteThreshold(contextWindow)
  const floor = INLINE_FLOOR_BY_TOOL[toolName]
  return floor === undefined ? resolved : Math.max(floor, resolved)
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

/**
 * 分页结果本身**永不再卸载**，否则读 artifact 会无限套娃。
 *
 * 分页上限 32KB，卸载阈值最低 8KB——读回来的一页必然超阈值，于是又被存成新 artifact：
 * 模型读 A 拿到页 B，B 被卸载成 C，读 C 又得到页 D……而这些页的顶层字段是
 * schemaVersion/content/nextCursor 那一套，跟它想读的发现结果完全不同形状。
 *
 * 实测 camera 场景里模型因此彻底分不清手上是哪个 artifact，反复请求发现结果的字段却总是
 * 拿到分页壳的字段清单，31 轮 0 个 Effect。分页已经由 limitBytes 限住了，再卸载一次是自相矛盾。
 */
function isArtifactPage(output: unknown): boolean {
  return Boolean(output)
    && typeof output === 'object'
    && !Array.isArray(output)
    && (output as Record<string, unknown>).contentEncoding === 'json-fragment'
    && typeof (output as Record<string, unknown>).artifactRef === 'string'
}

export function shouldOffloadObservation(
  output: unknown,
  byteThreshold = OFFLOAD_BYTE_THRESHOLD
): boolean {
  if (isArtifactPage(output)) return false
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

