import { v4 as uuidv4 } from 'uuid'

import type {
  ApplicationCompletedStepResult,
  ApplicationEvidence,
  ApplicationMutationExecutor,
  ApplicationPlannedStep,
} from '@/core/application-control'
import { applyWriterTable, propertyOperations, writableProperties } from '@/core/application-control'
import { createLogger } from '@/core/logging'

import { assetApplicationService } from './assetApplicationService'
import { ASSET_LIBRARY_WRITERS as WRITERS } from './assetFields'
import { ASSET_ENTITY_TYPES } from './assetReflection'

type MutationStep = Extract<ApplicationPlannedStep, { kind: 'mutation' }>

const logger = createLogger('features.assets.library_mutation')
const undoRecords = new Map<string, { libraryId: string; name: string }>()

/** 素材集合改名的通用属性执行器；界面与助手共用同一个平台领域入口。写入表定义收敛在 assetFields.ts。 */
export class AssetLibraryMutationExecutor implements ApplicationMutationExecutor {
  readonly entityType = ASSET_ENTITY_TYPES.library
  readonly writableProperties = writableProperties(WRITERS)
  readonly propertyOperations = propertyOperations(WRITERS)

  constructor(private readonly dependencies: {
    readRevision: () => number
    bumpRevision: () => void
  }) {}

  async apply(step: MutationStep): Promise<ApplicationCompletedStepResult> {
    const libraryId = step.target.id
    const library = (await assetApplicationService.listLibraries()).find((item) => item.id === libraryId)
    if (!library) throw new Error('ASSET_LIBRARY_NOT_FOUND：素材集合不存在。')
    const previousName = String(library.name)
    logger.info('素材集合属性写入开始', {
      event: 'asset.library_mutation.apply.start', libraryId,
    })
    try {
      await applyWriterTable(WRITERS, libraryId, step.mutations)
    } catch (error) {
      await assetApplicationService.renameLibrary(libraryId, previousName)
      logger.error('素材集合属性写入失败', error, {
        event: 'asset.library_mutation.apply.failed', libraryId,
      })
      throw error
    }
    this.dependencies.bumpRevision()
    const revision = this.dependencies.readRevision()
    const undoToken = `asset-library-undo:${uuidv4()}`
    undoRecords.set(undoToken, { libraryId, name: previousName })
    logger.info('素材集合属性写入完成', {
      event: 'asset.library_mutation.apply.completed', libraryId,
    })
    return {
      status: 'completed',
      resultingRevisions: { assets: revision },
      producedRefs: [{ kind: this.entityType, id: libraryId, revision }],
      evidence: [{
        kind: 'property_value',
        target: { kind: this.entityType, id: libraryId, revision },
        fact: '素材集合名称已更新。',
        data: step.mutations[step.mutations.length - 1]?.value ?? null,
        capturedAt: new Date().toISOString(),
      }],
      undoToken,
    }
  }

  async compensate(_step: MutationStep, result: ApplicationCompletedStepResult): Promise<ApplicationEvidence[]> {
    if (!result.undoToken) return []
    return (await this.undo(result.undoToken)).evidence
  }

  async undo(undoToken: string): Promise<ApplicationCompletedStepResult> {
    const record = undoRecords.get(undoToken)
    if (!record) throw new Error('ASSET_LIBRARY_UNDO_NOT_FOUND：素材集合撤销引用不存在或已使用。')
    await assetApplicationService.renameLibrary(record.libraryId, record.name)
    undoRecords.delete(undoToken)
    this.dependencies.bumpRevision()
    const revision = this.dependencies.readRevision()
    return {
      status: 'completed',
      resultingRevisions: { assets: revision },
      producedRefs: [{ kind: this.entityType, id: record.libraryId, revision }],
      evidence: [{
        kind: 'entity_state',
        target: { kind: this.entityType, id: record.libraryId, revision },
        fact: '素材集合名称写入已撤销。',
        capturedAt: new Date().toISOString(),
      }],
    }
  }
}

export function resetAssetLibraryMutationStateForTests(): void {
  undoRecords.clear()
}
