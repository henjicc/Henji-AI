import { v4 as uuidv4 } from 'uuid'

import type {
  ApplicationCompletedStepResult,
  ApplicationEvidence,
  ApplicationMutationExecutor,
  ApplicationPlannedStep,
} from '@/core/application-control'
import { applyWriterTable, propertyOperations, writableProperties } from '@/core/application-control'
import { createLogger } from '@/core/logging'

import {
  assetApplicationService,
  type AssetMutationSnapshot,
} from './assetApplicationService'
import { ASSET_WRITERS as WRITERS } from './assetFields'
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

/** 素材通用属性写入；全部状态变换委托素材领域服务，并保存可真实恢复的领域快照。写入表定义收敛在 assetFields.ts。 */
export class AssetMutationExecutor implements ApplicationMutationExecutor {
  readonly effectContract = { direct: [], cascades: [] }
  readonly entityType = ASSET_ENTITY_TYPES.asset
  readonly writableProperties = writableProperties(WRITERS)
  readonly propertyOperations = propertyOperations(WRITERS)

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
      await applyWriterTable(WRITERS, { assetId, applied }, step.mutations)
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
      directRefs: [{ kind: this.entityType, id: assetId, revision }],
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
      directRefs: [{ kind: this.entityType, id: record.assetId, revision }],
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
