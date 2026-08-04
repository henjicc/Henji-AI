import type {
  ApplicationCompletedStepResult,
  ApplicationEvidence,
  ApplicationMutationExecutor,
  ApplicationPlannedStep,
  JsonValue,
} from '@/core/application-control'
import { createLogger } from '@/core/logging'

import { assetApplicationService } from './assetApplicationService'
import { ASSET_ENTITY_TYPES } from './assetReflection'

type MutationStep = Extract<ApplicationPlannedStep, { kind: 'mutation' }>

const logger = createLogger('features.assets.mutation')

export interface AssetMutationDependencies {
  readRevision: () => number
  bumpRevision: () => void
}

const TAGS_PROPERTY = `${ASSET_ENTITY_TYPES.asset}.tags`
const LIBRARY_REFS_PROPERTY = `${ASSET_ENTITY_TYPES.asset}.library_refs`

function libraryId(value: JsonValue | undefined): string {
  const raw = typeof value === 'string'
    ? value
    : value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, JsonValue>).id
      : undefined
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error('ASSET_LIBRARY_REF_INVALID：集合引用必须是集合对象引用或集合 id 字符串。')
  }
  return raw
}

function tagList(value: JsonValue | undefined): string[] {
  if (!Array.isArray(value)) {
    throw new Error('ASSET_TAGS_INVALID：tags 必须是字符串数组。')
  }
  return value.map((item, index) => {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new Error(`ASSET_TAGS_INVALID：第 ${index} 个标签必须是非空字符串。`)
    }
    return item
  })
}

/**
 * 素材属性写入执行器。
 *
 * 覆盖两类可写属性，写入全部委托 `assetApplicationService`，执行器本身不碰任何存储：
 *
 * - `tags`：`set` 操作 → `replaceTags`
 * - `library_refs`：`append` / `remove` 操作 → `addToLibrary` / `removeFromLibrary`
 *
 * `library_refs` 是 `ref_list`，集合归属用属性的增删语义表达就够了，不需要独立的集合执行器——
 * 素材本身由导入链路创建，助手无法凭属性创建一个素材。
 *
 * 补这个执行器同时闭合了一个既有缺陷：`asset.tags` 早就声明为可写，但素材领域一个 mutation
 * 执行器都没有，`describe_application_entities` 会告诉模型这个属性能改，实际写入必然命中
 * `MUTATION_EXECUTOR_NOT_FOUND`。
 */
export class AssetMutationExecutor implements ApplicationMutationExecutor {
  readonly entityType = ASSET_ENTITY_TYPES.asset

  constructor(private readonly dependencies: AssetMutationDependencies) {}

  async apply(step: MutationStep): Promise<ApplicationCompletedStepResult> {
    const assetId = step.target.id
    const before = await assetApplicationService.read(assetId)
    logger.info('素材属性写入开始', {
      event: 'asset.mutation.apply.start',
      assetId,
      propertyIds: step.mutations.map((mutation) => mutation.propertyId),
    })
    const applied: string[] = []
    try {
      for (const mutation of step.mutations) {
        if (mutation.propertyId === TAGS_PROPERTY) {
          if (mutation.operation !== 'set') {
            throw new Error(`ASSET_TAGS_OPERATION_INVALID：标签只支持 set 操作，收到 ${mutation.operation}。`)
          }
          await assetApplicationService.replaceTags(assetId, tagList(mutation.value))
          applied.push(mutation.propertyId)
          continue
        }
        if (mutation.propertyId === LIBRARY_REFS_PROPERTY) {
          if (mutation.operation === 'append') {
            await assetApplicationService.addToLibrary(libraryId(mutation.value), assetId)
          } else if (mutation.operation === 'remove') {
            await assetApplicationService.removeFromLibrary(libraryId(mutation.value), assetId)
          } else {
            throw new Error(
              `ASSET_LIBRARY_OPERATION_INVALID：集合归属只支持 append / remove 操作，收到 ${mutation.operation}。`
              + '整体替换所属集合请分别 remove 旧集合、append 新集合。'
            )
          }
          applied.push(mutation.propertyId)
          continue
        }
        throw new Error(
          `ASSET_PROPERTY_NOT_WRITABLE：${mutation.propertyId} 不可写。`
          + `素材可写属性只有 ${TAGS_PROPERTY} 与 ${LIBRARY_REFS_PROPERTY}，其余由导入与检查链路维护。`
        )
      }
    } catch (error) {
      await this.restore(assetId, before, applied)
      logger.error('素材属性写入失败', error, {
        event: 'asset.mutation.apply.failed', assetId, appliedCount: applied.length,
      })
      throw error
    }
    this.dependencies.bumpRevision()
    const revision = this.dependencies.readRevision()
    logger.info('素材属性写入完成', {
      event: 'asset.mutation.apply.completed', assetId, propertyIds: applied,
    })
    return {
      status: 'completed',
      resultingRevisions: { assets: revision },
      producedRefs: [{ kind: this.entityType, id: assetId, revision }],
      evidence: step.mutations.map((mutation) => ({
        kind: 'property_value' as const,
        target: { kind: this.entityType, id: assetId, revision },
        fact: `素材属性 ${mutation.propertyId} 已更新。`,
        data: mutation.value ?? null,
        capturedAt: new Date().toISOString(),
      })),
      undoToken: `asset-undo:${assetId}:${JSON.stringify(before[TAGS_PROPERTY] ?? null)}`,
    }
  }

  async compensate(step: MutationStep, result: ApplicationCompletedStepResult): Promise<ApplicationEvidence[]> {
    if (!result.undoToken) return []
    return (await this.undo(result.undoToken)).evidence
  }

  async undo(undoToken: string): Promise<ApplicationCompletedStepResult> {
    const separator = undoToken.indexOf(':', 'asset-undo:'.length)
    const assetId = undoToken.slice('asset-undo:'.length, separator)
    const tags = JSON.parse(undoToken.slice(separator + 1)) as unknown
    if (Array.isArray(tags)) await assetApplicationService.replaceTags(assetId, tags.map(String))
    this.dependencies.bumpRevision()
    const revision = this.dependencies.readRevision()
    return {
      status: 'completed',
      resultingRevisions: { assets: revision },
      producedRefs: [{ kind: this.entityType, id: assetId, revision }],
      evidence: [{
        kind: 'entity_state',
        target: { kind: this.entityType, id: assetId, revision },
        fact: '素材属性写入已撤销。',
        capturedAt: new Date().toISOString(),
      }],
    }
  }

  /** 部分写入后的回滚：把已经改过的属性恢复到写入前的值。回滚自身失败不覆盖原始错误。 */
  private async restore(assetId: string, before: Record<string, unknown>, applied: string[]): Promise<void> {
    if (applied.length === 0) return
    try {
      if (applied.includes(TAGS_PROPERTY)) {
        const original = before[TAGS_PROPERTY]
        if (Array.isArray(original)) await assetApplicationService.replaceTags(assetId, original.map(String))
      }
      if (applied.includes(LIBRARY_REFS_PROPERTY)) {
        logger.warn('素材集合归属无法自动回滚，需要人工核对', {
          event: 'asset.mutation.rollback.partial', assetId,
        })
      }
    } catch (rollbackError) {
      logger.error('素材属性回滚失败', rollbackError, {
        event: 'asset.mutation.rollback.failed', assetId,
      })
    }
  }
}
