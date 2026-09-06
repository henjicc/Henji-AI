import { createLogger } from '@/core/logging'
import type { ImageEditSessionReferenceV3 } from '@/core/imageEdit/v3/sessionReference'
import { exportMultiLayerDocumentRaster } from './multiLayerDocumentNodeExportOperation'
import { retainsCanvasMutation } from './canvasPersistenceService'

import type { LayerStackResultNodeData } from '../domain/canvasNodeData'
import { validateLayerStackDocument, type LayerStackDocumentV1 } from '../domain/layerStack'
import {
  MultiLayerDocumentNodeContractError,
  parseMultiLayerDocumentNodeState,
} from '../domain/multiLayerDocumentNode'
import {
  MULTI_LAYER_NODE_PROJECTION_HISTORY_POLICY,
  MultiLayerDocumentNodeApplicationError,
  type MultiLayerDocumentExportRaster,
  type MultiLayerDocumentNodeApplicationService,
  type MultiLayerDocumentNodeCanvasPort,
  type MultiLayerDocumentNodePort,
  type MultiLayerDocumentNodeProjection,
} from './multiLayerDocumentNodeApplicationContracts'

export {
  MULTI_LAYER_NODE_PROJECTION_HISTORY_POLICY,
  MultiLayerDocumentNodeApplicationError,
} from './multiLayerDocumentNodeApplicationContracts'
export type {
  MultiLayerDocumentExportRaster,
  MultiLayerDocumentNodeApplicationErrorCode,
  MultiLayerDocumentNodeApplicationService,
  MultiLayerDocumentNodeCanvasPort,
  MultiLayerDocumentNodeMaterialization,
  MultiLayerDocumentNodePort,
  MultiLayerDocumentNodeProjection,
} from './multiLayerDocumentNodeApplicationContracts'

const logger = createLogger('features.canvas.multi_layer_document_node')

interface ServiceDependencies {
  documentPort: MultiLayerDocumentNodePort
  canvasPort: MultiLayerDocumentNodeCanvasPort
}

function requiredId(value: string, field: string): string {
  if (!value.trim()) {
    throw new MultiLayerDocumentNodeApplicationError('INVALID_INPUT', `${field} 不能为空`, false)
  }
  return value
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new MultiLayerDocumentNodeApplicationError('CANCELLED', '多图层文档操作已取消', true)
  }
}

function sameSession(
  left: ImageEditSessionReferenceV3,
  right: ImageEditSessionReferenceV3,
): boolean {
  return left.kind === right.kind
    && left.documentRef === right.documentRef
    && left.revision === right.revision
    && left.previewRef === right.previewRef
    && left.sourceUrl === right.sourceUrl
}

function editableSession(data: LayerStackResultNodeData): ImageEditSessionReferenceV3 {
  let state
  try {
    state = parseMultiLayerDocumentNodeState(data)
  } catch (error) {
    throw new MultiLayerDocumentNodeApplicationError(
      'INVALID_NODE_STATE',
      error instanceof Error ? error.message : '多图层文档节点状态无效',
      false,
      { cause: error },
    )
  }
  if (state.kind === 'legacy-v1-pending-migration') {
    throw new MultiLayerDocumentNodeApplicationError(
      'MIGRATION_REQUIRED',
      '旧版图层文档需要先迁移为 V3 文档',
      true,
    )
  }
  if (state.kind !== 'editable-v3') {
    throw new MultiLayerDocumentNodeApplicationError(
      'INVALID_NODE_STATE',
      state.kind === 'degraded'
        ? `多图层文档资源不可用：${state.reason}`
        : '生成占位节点尚没有可编辑文档',
      state.kind === 'degraded',
    )
  }
  return state.session
}

function validateProjection(
  projection: MultiLayerDocumentNodeProjection,
): MultiLayerDocumentNodeProjection {
  if (!projection.aspectRatio.trim()) {
    throw new MultiLayerDocumentNodeApplicationError('INVALID_NODE_STATE', '文档投影缺少画布宽高比', false)
  }
  try {
    const state = parseMultiLayerDocumentNodeState({
      resultKind: 'layer-stack',
      imageUrl: projection.imageUrl,
      previewImageUrl: projection.previewImageUrl,
      aspectRatio: projection.aspectRatio,
      imageEditSession: projection.imageEditSession,
    })
    if (state.kind !== 'editable-v3') throw new Error('文档投影不是可编辑 V3 完成态')
    return projection
  } catch (error) {
    throw new MultiLayerDocumentNodeApplicationError(
      'INVALID_NODE_STATE',
      error instanceof Error ? error.message : '多图层文档投影无效',
      false,
      { cause: error },
    )
  }
}


async function runOperation<T>(input: {
  operation: string
  nodeId: string
  signal?: AbortSignal
  execute: () => Promise<T>
}): Promise<T> {
  logger.info('多图层文档操作开始', {
    event: `canvas.multi_layer_document.${input.operation}.start`,
    nodeId: input.nodeId,
  })
  try {
    throwIfCancelled(input.signal)
    const result = await input.execute()
    throwIfCancelled(input.signal)
    logger.info('多图层文档操作完成', {
      event: `canvas.multi_layer_document.${input.operation}.completed`,
      nodeId: input.nodeId,
    })
    return result
  } catch (error) {
    if (retainsCanvasMutation(error)) {
      logger.error('多图层文档画布保存尚未确认，已保留当前内容', error, {
        event: `canvas.multi_layer_document.${input.operation}.failed`, nodeId: input.nodeId,
      })
      throw error
    }
    const normalized = error instanceof MultiLayerDocumentNodeApplicationError
      ? error
      : input.signal?.aborted || (error instanceof Error && error.name === 'AbortError')
        ? new MultiLayerDocumentNodeApplicationError('CANCELLED', '多图层文档操作已取消', true, { cause: error })
        : error instanceof MultiLayerDocumentNodeContractError
          ? new MultiLayerDocumentNodeApplicationError(
              error.code === 'UNSUPPORTED_EXPORT_TARGET' ? 'UNSUPPORTED_EXPORT_TARGET' : 'INVALID_INPUT',
              error.message,
              false,
              { cause: error },
            )
          : new MultiLayerDocumentNodeApplicationError(
              'OPERATION_FAILED',
              error instanceof Error ? error.message : '多图层文档操作失败',
              true,
              { cause: error },
            )
    logger.error('多图层文档操作失败', normalized, {
      event: `canvas.multi_layer_document.${input.operation}.failed`,
      nodeId: input.nodeId,
      context: { code: normalized.code, recoverable: normalized.recoverable },
    })
    throw normalized
  }
}

export function createMultiLayerDocumentNodeApplicationService(
  dependencies: ServiceDependencies,
): MultiLayerDocumentNodeApplicationService {
  return {
    async createFromLayerStack(input): Promise<MultiLayerDocumentNodeProjection> {
      return runOperation({
        operation: 'create',
        nodeId: requiredId(input.nodeId, 'nodeId'),
        signal: input.signal,
        execute: async () => {
          let document: LayerStackDocumentV1
          try {
            document = validateLayerStackDocument(input.document)
          } catch (error) {
            throw new MultiLayerDocumentNodeApplicationError(
              'INVALID_INPUT',
              error instanceof Error ? error.message : 'V1 图层栈无效',
              false,
              { cause: error },
            )
          }
          if (document.status !== 'ready') {
            throw new MultiLayerDocumentNodeApplicationError(
              'INVALID_INPUT',
              '不能从资源缺失的 V1 图层栈创建 V3 文档',
              true,
            )
          }
          return validateProjection(await dependencies.documentPort.createFromLayerStack({
            ...input,
            document,
          }))
        },
      })
    },

    async openAndValidate(input): Promise<ImageEditSessionReferenceV3> {
      return runOperation({
        operation: 'open',
        nodeId: requiredId(input.nodeId, 'nodeId'),
        signal: input.signal,
        execute: async () => {
          const expected = editableSession(input.data)
          const actual = await dependencies.documentPort.inspectDocument({
            session: expected,
            signal: input.signal,
          })
          if (!sameSession(expected, actual)) {
            throw new MultiLayerDocumentNodeApplicationError(
              'DOCUMENT_CONFLICT',
              '节点保存的文档版本与权威文档不一致',
              true,
            )
          }
          return actual
        },
      })
    },

    async migrateLegacyDocument(input): Promise<MultiLayerDocumentNodeProjection> {
      return runOperation({
        operation: 'migrate_legacy_v1',
        nodeId: requiredId(input.nodeId, 'nodeId'),
        signal: input.signal,
        execute: async () => {
          requiredId(input.projectId, 'projectId')
          const state = parseMultiLayerDocumentNodeState(input.data)
          if (state.kind === 'editable-v3') {
            return validateProjection({
              imageEditSession: state.session,
              imageUrl: state.imageUrl,
              previewImageUrl: state.previewImageUrl,
              aspectRatio: input.data.aspectRatio ?? '1:1',
            })
          }
          if (state.kind !== 'legacy-v1-pending-migration') {
            throw new MultiLayerDocumentNodeApplicationError(
              'MIGRATION_REQUIRED',
              '当前节点没有可迁移的旧版图层文档',
              true,
            )
          }
          const projection = validateProjection(await dependencies.documentPort.createFromLayerStack({
            nodeId: input.nodeId,
            document: state.document,
            signal: input.signal,
          }))
          try {
            await dependencies.canvasPort.commitLegacyMigration({
              projectId: input.projectId,
              nodeId: input.nodeId,
              expectedDocument: state.document,
              projection,
              historyPolicy: MULTI_LAYER_NODE_PROJECTION_HISTORY_POLICY,
            })
            return projection
          } catch (error) {
            if (retainsCanvasMutation(error)) throw error
            await dependencies.documentPort.markReleaseCandidate({
              nodeId: input.nodeId,
              session: projection.imageEditSession,
              signal: input.signal,
            }).catch((cleanupError) => {
              logger.error('旧版图层文档迁移失败后的候选登记失败', cleanupError, {
                event: 'canvas.multi_layer_document.migrate_legacy_v1.cleanup_candidate.failed',
                nodeId: input.nodeId,
                context: {
                  documentRef: projection.imageEditSession.documentRef,
                  revision: projection.imageEditSession.revision,
                  cleanupCandidate: true,
                },
              })
            })
            throw error
          }
        },
      })
    },

    async saveMaterializedProjection(input): Promise<MultiLayerDocumentNodeProjection> {
      return runOperation({
        operation: 'save_materialized_projection',
        nodeId: requiredId(input.nodeId, 'nodeId'),
        signal: input.signal,
        execute: async () => {
          requiredId(input.projectId, 'projectId')
          const previous = editableSession(input.data)
          if (
            input.session.documentRef !== previous.documentRef
            || input.session.revision < previous.revision
          ) {
            throw new MultiLayerDocumentNodeApplicationError(
              'DOCUMENT_CONFLICT',
              '关闭保存结果切换了文档或倒退了版本',
              true,
            )
          }
          const materialization = await dependencies.documentPort.saveAndMaterialize({
            session: input.session,
            signal: input.signal,
          })
          let projection: MultiLayerDocumentNodeProjection
          try {
            projection = validateProjection(materialization.projection)
            if (
              projection.imageEditSession.documentRef !== input.session.documentRef
              || projection.imageEditSession.revision !== input.session.revision
            ) {
              throw new MultiLayerDocumentNodeApplicationError(
                'DOCUMENT_CONFLICT',
                '保存物化结果与关闭时的权威文档版本不一致',
                true,
              )
            }
            await dependencies.canvasPort.commitMaterializedProjection({
              projectId: input.projectId,
              nodeId: input.nodeId,
              expectedSession: previous,
              projection,
              historyPolicy: MULTI_LAYER_NODE_PROJECTION_HISTORY_POLICY,
            })
          } catch (error) {
            if (retainsCanvasMutation(error)) throw error
            await dependencies.documentPort.rollbackMaterialization({ materialization }).then((rolledBack) => {
              if (rolledBack) return
              logger.error(
                '文档节点投影未接管且预览资源无法精确回滚',
                new Error('文档版本或 previewRef 已变化，已登记为清理候选'),
                {
                  event: 'canvas.multi_layer_document.save_materialized_projection.rollback.failed',
                  nodeId: input.nodeId,
                  context: {
                    documentRef: materialization.rollback.documentRef,
                    revision: materialization.rollback.revision,
                    cleanupCandidate: true,
                  },
                },
              )
            }).catch((rollbackError) => {
              logger.error('文档节点投影未接管后的预览资源回滚失败', rollbackError, {
                event: 'canvas.multi_layer_document.save_materialized_projection.rollback.failed',
                nodeId: input.nodeId,
                context: {
                  documentRef: materialization.rollback.documentRef,
                  revision: materialization.rollback.revision,
                  cleanupCandidate: true,
                },
              })
            })
            throw error
          }
          await dependencies.documentPort.finalizeMaterialization({ materialization }).then((finalized) => {
            if (finalized) return
            logger.error(
              '节点投影已提交但旧预览资源无法精确释放',
              new Error('文档版本或 previewRef 已变化，已登记为清理候选'),
              {
                event: 'canvas.multi_layer_document.save_materialized_projection.finalize.failed',
                nodeId: input.nodeId,
                context: {
                  documentRef: materialization.rollback.documentRef,
                  revision: materialization.rollback.revision,
                  cleanupCandidate: true,
                },
              },
            )
          }).catch((finalizeError) => {
            logger.error('节点投影已提交但旧预览资源释放失败', finalizeError, {
              event: 'canvas.multi_layer_document.save_materialized_projection.finalize.failed',
              nodeId: input.nodeId,
              context: {
                documentRef: materialization.rollback.documentRef,
                revision: materialization.rollback.revision,
                cleanupCandidate: true,
              },
            })
          })
          return projection
        },
      })
    },

    async forkDocument(input): Promise<MultiLayerDocumentNodeProjection> {
      return runOperation({
        operation: 'fork',
        nodeId: requiredId(input.sourceNodeId, 'sourceNodeId'),
        signal: input.signal,
        execute: async () => {
          requiredId(input.targetNodeId, 'targetNodeId')
          const source = editableSession(input.data)
          const forked = validateProjection(await dependencies.documentPort.forkDocument({
            sourceNodeId: input.sourceNodeId,
            targetNodeId: input.targetNodeId,
            session: source,
            signal: input.signal,
          }))
          if (forked.imageEditSession.documentRef === source.documentRef) {
            throw new MultiLayerDocumentNodeApplicationError(
              'DOCUMENT_CONFLICT',
              '复制节点不能与原节点共享可写文档',
              false,
            )
          }
          return forked
        },
      })
    },

    async markReleaseCandidate(input): Promise<void> {
      return runOperation({
        operation: 'mark_release_candidate',
        nodeId: requiredId(input.nodeId, 'nodeId'),
        signal: input.signal,
        execute: async () => {
          const session = editableSession(input.data)
          await dependencies.documentPort.markReleaseCandidate({
            nodeId: input.nodeId,
            session,
            signal: input.signal,
          })
        },
      })
    },

    async exportTarget(input): Promise<{
      nodeId: string
      edgeId: string
      undoRef: string
      raster: MultiLayerDocumentExportRaster
    }> {
      return runOperation({
        operation: 'export_target',
        nodeId: requiredId(input.sourceNodeId, 'sourceNodeId'),
        signal: input.signal,
        execute: async () => {
          requiredId(input.projectId, 'projectId')
          return exportMultiLayerDocumentRaster(dependencies, input, editableSession(input.data))
        },
      })
    },
  }
}
