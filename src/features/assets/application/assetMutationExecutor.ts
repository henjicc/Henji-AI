import { v4 as uuidv4 } from 'uuid'

import type {
  ApplicationCompletedStepResult,
  ApplicationEvidence,
  ApplicationMutationExecutor,
  ApplicationPlannedStep,
  JsonValue,
} from '@/core/application-control'
import { createLogger } from '@/core/logging'

import {
  assetApplicationService,
  type AssetMutationSnapshot,
} from './assetApplicationService'
import { ASSET_ENTITY_TYPES } from './assetReflection'

type MutationStep = Extract<ApplicationPlannedStep, { kind: 'mutation' }>

const logger = createLogger('features.assets.mutation')

export interface AssetMutationDependencies {
  readRevision: () => number
  bumpRevision: () => void
}

const DISPLAY_NAME_PROPERTY = `${ASSET_ENTITY_TYPES.asset}.display_name`
const TAGS_PROPERTY = `${ASSET_ENTITY_TYPES.asset}.tags`
const LIBRARY_REFS_PROPERTY = `${ASSET_ENTITY_TYPES.asset}.library_refs`

interface AssetUndoRecord {
  assetId: string
  snapshot: AssetMutationSnapshot
  propertyIds: string[]
}

const undoRecords = new Map<string, AssetUndoRecord>()

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
  if (!Array.isArray(value)) throw new Error('ASSET_TAGS_INVALID：tags 必须是字符串数组。')
  return value.map((item, index) => {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new Error(`ASSET_TAGS_INVALID：第 ${index} 个标签必须是非空字符串。`)
    }
    return item
  })
}

function displayName(value: JsonValue | undefined): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('ASSET_DISPLAY_NAME_INVALID：素材名称必须是非空字符串。')
  }
  return value
}

async function restoreSnapshot(
  assetId: string,
  snapshot: AssetMutationSnapshot,
  propertyIds: ReadonlySet<string>,
): Promise<void> {
  const failures: unknown[] = []
  if (propertyIds.has(DISPLAY_NAME_PROPERTY)) {
    try { await assetApplicationService.rename(assetId, snapshot.displayName) } catch (error) { failures.push(error) }
  }
  if (propertyIds.has(TAGS_PROPERTY)) {
    try { await assetApplicationService.replaceTags(assetId, snapshot.tags) } catch (error) { failures.push(error) }
  }
  if (propertyIds.has(LIBRARY_REFS_PROPERTY)) {
    try {
      const current = await assetApplicationService.readMutationSnapshot(assetId)
      const beforeIds = new Set(snapshot.libraryIds)
      const currentIds = new Set(current.libraryIds)
      for (const id of currentIds) {
        if (!beforeIds.has(id)) await assetApplicationService.removeFromLibrary(id, assetId)
      }
      for (const id of beforeIds) {
        if (!currentIds.has(id)) await assetApplicationService.addToLibrary(id, assetId)
      }
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length > 0) {
    throw new Error(`ASSET_ROLLBACK_FAILED：${failures.map(String).join('；')}`)
  }
}

/** 素材通用属性写入；全部状态变换委托素材领域服务，并保存可真实恢复的领域快照。 */
export class AssetMutationExecutor implements ApplicationMutationExecutor {
  readonly entityType = ASSET_ENTITY_TYPES.asset

  constructor(private readonly dependencies: AssetMutationDependencies) {}

  async apply(step: MutationStep): Promise<ApplicationCompletedStepResult> {
    const assetId = step.target.id
    const before = await assetApplicationService.readMutationSnapshot(assetId)
    logger.info('素材属性写入开始', {
      event: 'asset.mutation.apply.start', assetId,
      propertyIds: step.mutations.map((mutation) => mutation.propertyId),
    })
    const applied = new Set<string>()
    try {
      for (const mutation of step.mutations) {
        if (mutation.propertyId === DISPLAY_NAME_PROPERTY) {
          if (mutation.operation !== 'set') {
            throw new Error(`ASSET_DISPLAY_NAME_OPERATION_INVALID：素材名称只支持 set 操作，收到 ${mutation.operation}。`)
          }
          await assetApplicationService.rename(assetId, displayName(mutation.value))
        } else if (mutation.propertyId === TAGS_PROPERTY) {
          if (mutation.operation !== 'set') {
            throw new Error(`ASSET_TAGS_OPERATION_INVALID：标签只支持 set 操作，收到 ${mutation.operation}。`)
          }
          await assetApplicationService.replaceTags(assetId, tagList(mutation.value))
        } else if (mutation.propertyId === LIBRARY_REFS_PROPERTY) {
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
        } else {
          throw new Error(
            `ASSET_PROPERTY_NOT_WRITABLE：${mutation.propertyId} 不可写。`
            + `素材可写属性只有 ${DISPLAY_NAME_PROPERTY}、${TAGS_PROPERTY} 与 ${LIBRARY_REFS_PROPERTY}。`
          )
        }
        applied.add(mutation.propertyId)
      }
    } catch (error) {
      try {
        await restoreSnapshot(assetId, before, applied)
      } catch (rollbackError) {
        logger.error('素材属性回滚失败', rollbackError, {
          event: 'asset.mutation.rollback.failed', assetId, appliedCount: applied.size,
        })
        throw new Error(`ASSET_MUTATION_AND_ROLLBACK_FAILED：${String(error)}；${String(rollbackError)}`)
      }
      logger.error('素材属性写入失败', error, {
        event: 'asset.mutation.apply.failed', assetId, appliedCount: applied.size,
      })
      throw error
    }

    this.dependencies.bumpRevision()
    const revision = this.dependencies.readRevision()
    const undoToken = `asset-undo:${uuidv4()}`
    undoRecords.set(undoToken, { assetId, snapshot: before, propertyIds: [...applied] })
    logger.info('素材属性写入完成', {
      event: 'asset.mutation.apply.completed', assetId, propertyIds: [...applied],
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
      undoToken,
    }
  }

  async compensate(_step: MutationStep, result: ApplicationCompletedStepResult): Promise<ApplicationEvidence[]> {
    if (!result.undoToken) return []
    return (await this.undo(result.undoToken)).evidence
  }

  async undo(undoToken: string): Promise<ApplicationCompletedStepResult> {
    const record = undoRecords.get(undoToken)
    if (!record) throw new Error('ASSET_UNDO_NOT_FOUND：素材撤销引用不存在或已使用。')
    await restoreSnapshot(record.assetId, record.snapshot, new Set(record.propertyIds))
    undoRecords.delete(undoToken)
    this.dependencies.bumpRevision()
    const revision = this.dependencies.readRevision()
    logger.info('素材属性写入已撤销', {
      event: 'asset.mutation.undo.completed', assetId: record.assetId,
    })
    return {
      status: 'completed',
      resultingRevisions: { assets: revision },
      producedRefs: [{ kind: this.entityType, id: record.assetId, revision }],
      evidence: [{
        kind: 'entity_state',
        target: { kind: this.entityType, id: record.assetId, revision },
        fact: '素材属性写入已撤销。',
        capturedAt: new Date().toISOString(),
      }],
    }
  }
}

export function resetAssetMutationUndoStateForTests(): void {
  undoRecords.clear()
}
