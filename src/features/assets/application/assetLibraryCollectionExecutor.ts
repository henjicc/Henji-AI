import { v4 as uuidv4 } from 'uuid'

import type {
  ApplicationCollectionExecutor,
  ApplicationCompletedStepResult,
  ApplicationEvidence,
  ApplicationPlannedStep,
  JsonValue,
} from '@/core/application-control'
import { createLogger } from '@/core/logging'
import type { AssetLibrarySnapshot } from '@/platform/contracts/assetLibrary'

import { assetApplicationService } from './assetApplicationService'
import { ASSET_ENTITY_TYPES } from './assetReflection'

type CollectionStep = Extract<ApplicationPlannedStep, { kind: 'collection' }>
type UndoRecord =
  | { kind: 'create'; libraryIds: string[] }
  | { kind: 'remove'; snapshots: AssetLibrarySnapshot[] }

const NAME_PROPERTY = `${ASSET_ENTITY_TYPES.library}.name`
const logger = createLogger('features.assets.library_collection')
const undoRecords = new Map<string, UndoRecord>()

function libraryName(value: JsonValue | undefined): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`ASSET_LIBRARY_NAME_INVALID：${NAME_PROPERTY} 必须是非空字符串。`)
  }
  const normalized = value.trim()
  if (normalized.length > 200) throw new Error('ASSET_LIBRARY_NAME_INVALID：素材集合名称最多 200 个字符。')
  return normalized
}

async function rollbackCreated(libraryIds: string[]): Promise<void> {
  for (const libraryId of [...libraryIds].reverse()) await assetApplicationService.deleteLibrary(libraryId)
}

async function rollbackRemoved(snapshots: AssetLibrarySnapshot[]): Promise<void> {
  for (const snapshot of [...snapshots].reverse()) await assetApplicationService.restoreLibrary(snapshot)
}

/** 素材集合的创建/删除执行器；删除前保存集合及成员关系，补偿时按原稳定 ID 原子恢复。 */
export class AssetLibraryCollectionExecutor implements ApplicationCollectionExecutor {
  readonly entityType = ASSET_ENTITY_TYPES.library

  constructor(private readonly dependencies: {
    readRevision: () => number
    bumpRevision: () => void
  }) {}

  async apply(step: CollectionStep): Promise<ApplicationCompletedStepResult> {
    if (step.parent.kind !== ASSET_ENTITY_TYPES.catalog || step.parent.id !== 'default') {
      throw new Error('ASSET_CATALOG_REF_INVALID：素材集合只能在 asset.catalog/default 下增删。')
    }
    logger.info('素材集合写入开始', {
      event: 'asset.library_collection.apply.start', operation: step.operation.kind,
    })
    const created: Array<Record<string, unknown>> = []
    const removed: AssetLibrarySnapshot[] = []
    try {
      if (step.operation.kind === 'create') {
        for (const item of step.operation.items) {
          created.push(await assetApplicationService.createLibrary(libraryName(item.properties[NAME_PROPERTY])))
        }
      } else {
        if (step.operation.targets.some((target) => target.kind !== ASSET_ENTITY_TYPES.library)) {
          throw new Error('ASSET_LIBRARY_REF_INVALID：删除目标必须是 asset.library 引用。')
        }
        const snapshots = await Promise.all(
          step.operation.targets.map((target) => assetApplicationService.inspectLibrary(target.id))
        )
        for (const snapshot of snapshots) {
          await assetApplicationService.deleteLibrary(snapshot.id)
          removed.push(snapshot)
        }
      }
    } catch (error) {
      try {
        if (created.length > 0) await rollbackCreated(created.map((item) => String(item.id)))
        if (removed.length > 0) await rollbackRemoved(removed)
      } catch (rollbackError) {
        logger.error('素材集合写入回滚失败', rollbackError, {
          event: 'asset.library_collection.rollback.failed', operation: step.operation.kind,
        })
        throw new Error(`ASSET_LIBRARY_MUTATION_AND_ROLLBACK_FAILED：${String(error)}；${String(rollbackError)}`)
      }
      logger.error('素材集合写入失败', error, {
        event: 'asset.library_collection.apply.failed', operation: step.operation.kind,
      })
      throw error
    }

    this.dependencies.bumpRevision()
    const revision = this.dependencies.readRevision()
    const undoToken = `asset-library-collection-undo:${uuidv4()}`
    undoRecords.set(undoToken, step.operation.kind === 'create'
      ? { kind: 'create', libraryIds: created.map((item) => String(item.id)) }
      : { kind: 'remove', snapshots: removed })
    logger.info('素材集合写入完成', {
      event: 'asset.library_collection.apply.completed', operation: step.operation.kind,
      itemCount: step.operation.kind === 'create' ? created.length : removed.length,
    })
    return {
      status: 'completed',
      resultingRevisions: { assets: revision },
      producedRefs: created.map((item) => ({
        kind: this.entityType,
        id: String(item.id),
        label: String(item.name),
        revision,
      })),
      evidence: [{
        kind: 'operation_result',
        target: { kind: ASSET_ENTITY_TYPES.catalog, id: step.parent.id, revision },
        fact: step.operation.kind === 'create'
          ? `已创建 ${created.length} 个素材集合。`
          : `已删除 ${removed.length} 个素材集合。`,
        data: { operation: step.operation.kind, itemCount: step.operation.kind === 'create' ? created.length : removed.length },
        capturedAt: new Date().toISOString(),
      }],
      undoToken,
    }
  }

  async compensate(_step: CollectionStep, result: ApplicationCompletedStepResult): Promise<ApplicationEvidence[]> {
    if (!result.undoToken) return []
    return (await this.undo(result.undoToken)).evidence
  }

  async undo(undoToken: string): Promise<ApplicationCompletedStepResult> {
    const record = undoRecords.get(undoToken)
    if (!record) throw new Error('ASSET_LIBRARY_COLLECTION_UNDO_NOT_FOUND')
    if (record.kind === 'create') await rollbackCreated(record.libraryIds)
    else await rollbackRemoved(record.snapshots)
    undoRecords.delete(undoToken)
    this.dependencies.bumpRevision()
    const revision = this.dependencies.readRevision()
    return {
      status: 'completed',
      resultingRevisions: { assets: revision },
      producedRefs: [],
      evidence: [{
        kind: 'entity_state',
        target: { kind: ASSET_ENTITY_TYPES.catalog, id: 'default', revision },
        fact: '素材集合写入已撤销。',
        capturedAt: new Date().toISOString(),
      }],
    }
  }
}

export function resetAssetLibraryCollectionStateForTests(): void {
  undoRecords.clear()
}
