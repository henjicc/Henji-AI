import {
  ImageEditorV3CommandRepository,
  loadImageEditorV3Document,
} from '@/commands/imageEditorV3'
import { createLogger } from '@/core/logging'
import type { ImageEditSessionReferenceV3 } from '@/core/imageEdit/v3/sessionReference'
import type {
  ImageEditorV3DocumentSnapshot,
  ImageEditorV3ResourceRef,
} from '@/platform/contracts/imageEditorV3'

import { reduceAspectRatio } from '../application/imageData'
import {
  MultiLayerDocumentNodeApplicationError,
  type MultiLayerDocumentNodeMaterialization,
  type MultiLayerDocumentNodePort,
} from '../application/multiLayerDocumentNodeApplicationContracts'
import {
  CanvasEditV3MaterializationContractError,
  materializeCanvasEditV3Snapshot,
  type CanvasEditV3MaterializationResult,
} from './canvasEditV3Materialization'

const logger = createLogger('features.canvas.multi_layer_document_projection')

type ProjectionPort = Pick<
  MultiLayerDocumentNodePort,
  'saveAndMaterialize' | 'rollbackMaterialization' | 'finalizeMaterialization'
>

interface ProjectionAdapterDependencies {
  loadDocument?: typeof loadImageEditorV3Document
  materialize?: typeof materializeCanvasEditV3Snapshot
  restorePreview?: (
    snapshot: ImageEditorV3DocumentSnapshot,
    previewRef: ImageEditorV3ResourceRef | null,
  ) => Promise<void>
  collectGarbage?: (
    documentId: string,
    retainedResourceRefs: readonly ImageEditorV3ResourceRef[],
  ) => Promise<void>
}

function documentIdFromRef(documentRef: ImageEditSessionReferenceV3['documentRef']): string {
  return documentRef.slice('image-edit-v3:'.length)
}

function assertSnapshot(
  snapshot: ImageEditorV3DocumentSnapshot | null,
  session: ImageEditSessionReferenceV3,
): asserts snapshot is ImageEditorV3DocumentSnapshot {
  if (!snapshot) {
    throw new MultiLayerDocumentNodeApplicationError(
      'DOCUMENT_NOT_FOUND',
      '多图层图片文档不存在',
      true,
    )
  }
  if (
    snapshot.documentRef !== session.documentRef
    || snapshot.document.id !== documentIdFromRef(session.documentRef)
    || snapshot.revision !== session.revision
    || snapshot.document.revision !== session.revision
  ) {
    throw new MultiLayerDocumentNodeApplicationError(
      'DOCUMENT_CONFLICT',
      '关闭物化前文档版本已变化',
      true,
    )
  }
}

function createMaterialization(
  snapshot: ImageEditorV3DocumentSnapshot,
  result: CanvasEditV3MaterializationResult,
): MultiLayerDocumentNodeMaterialization {
  if (
    result.raster.documentRef !== snapshot.documentRef
    || result.raster.revision !== snapshot.revision
    || result.raster.sourceFingerprint !== snapshot.sourceFingerprint
    || result.session.documentRef !== snapshot.documentRef
    || result.session.revision !== snapshot.revision
    || result.session.previewRef !== result.raster.previewRef
    || result.session.sourceUrl !== result.raster.mediaUrl
    || !Number.isSafeInteger(result.raster.width)
    || result.raster.width < 1
    || !Number.isSafeInteger(result.raster.height)
    || result.raster.height < 1
  ) {
    throw new MultiLayerDocumentNodeApplicationError(
      'DOCUMENT_CONFLICT',
      '关闭物化结果与权威文档快照不一致',
      true,
    )
  }
  return {
    projection: {
      imageEditSession: result.session,
      imageUrl: result.raster.mediaUrl,
      previewImageUrl: result.raster.mediaUrl,
      aspectRatio: reduceAspectRatio(result.raster.width, result.raster.height),
    },
    rollback: {
      documentRef: snapshot.documentRef,
      revision: snapshot.revision,
      sourceFingerprint: snapshot.sourceFingerprint,
      previousPreviewRef: snapshot.previewRef,
      installedPreviewRef: result.raster.previewRef,
    },
  }
}

export function createMultiLayerDocumentProjectionPort(
  dependencies: ProjectionAdapterDependencies = {},
): ProjectionPort {
  const loadDocument = dependencies.loadDocument ?? loadImageEditorV3Document
  const materialize = dependencies.materialize ?? materializeCanvasEditV3Snapshot
  const repository = new ImageEditorV3CommandRepository()
  const restorePreview = dependencies.restorePreview ?? (async (snapshot, previewRef) => {
    const restored = await repository.save(snapshot.document, {
      expectedRevision: snapshot.revision,
      previewRef,
      history: snapshot.history,
    })
    if (
      restored.revision !== snapshot.revision
      || restored.previewRef !== previewRef
    ) {
      throw new Error('文档预览回滚没有恢复精确 revision')
    }
  })
  const collectGarbage = dependencies.collectGarbage
    ?? ((documentId, retainedResourceRefs) => repository.collectGarbage(
      documentId,
      retainedResourceRefs,
    ))

  const rollbackMaterialization: ProjectionPort['rollbackMaterialization'] = async ({ materialization }) => {
    const token = materialization.rollback
    const current = await loadDocument({
      requestId: `image-editor-v3:multi-layer-projection-rollback:${crypto.randomUUID()}`,
      documentRef: token.documentRef,
    })
    if (
      !current
      || current.documentRef !== token.documentRef
      || current.revision !== token.revision
      || current.document.revision !== token.revision
      || current.sourceFingerprint !== token.sourceFingerprint
      || current.previewRef !== token.installedPreviewRef
    ) {
      return false
    }
    await restorePreview(current, token.previousPreviewRef)
    const retained = current.resourceRefs.filter((ref) => ref !== token.installedPreviewRef)
    if (token.previousPreviewRef && !retained.includes(token.previousPreviewRef)) {
      retained.push(token.previousPreviewRef)
    }
    await collectGarbage(current.document.id, retained)
    return true
  }

  const finalizeMaterialization: ProjectionPort['finalizeMaterialization'] = async ({ materialization }) => {
    const token = materialization.rollback
    if (!token.previousPreviewRef || token.previousPreviewRef === token.installedPreviewRef) {
      return true
    }
    const current = await loadDocument({
      requestId: `image-editor-v3:multi-layer-projection-finalize:${crypto.randomUUID()}`,
      documentRef: token.documentRef,
    })
    if (
      !current
      || current.documentRef !== token.documentRef
      || current.revision !== token.revision
      || current.document.revision !== token.revision
      || current.sourceFingerprint !== token.sourceFingerprint
      || current.previewRef !== token.installedPreviewRef
    ) {
      return false
    }
    await restorePreview(current, token.installedPreviewRef)
    await collectGarbage(
      current.document.id,
      current.resourceRefs.filter((ref) => ref !== token.previousPreviewRef),
    )
    return true
  }

  return {
    async saveAndMaterialize({ session, signal }): Promise<MultiLayerDocumentNodeMaterialization> {
      const snapshot = await loadDocument({
        requestId: `image-editor-v3:multi-layer-projection-load:${crypto.randomUUID()}`,
        documentRef: session.documentRef,
      }, signal)
      assertSnapshot(snapshot, session)
      let result: CanvasEditV3MaterializationResult
      try {
        result = await materialize(snapshot, '多图层图片文档', signal)
      } catch (error) {
        if (error instanceof CanvasEditV3MaterializationContractError) {
          try {
            const materialization = createMaterialization(snapshot, error.result)
            await rollbackMaterialization({ materialization })
          } catch (rollbackError) {
            logger.error('无效整图物化结果的预览资源回滚失败', rollbackError, {
              event: 'canvas.multi_layer_document.projection.invalid_result_rollback.failed',
              context: {
                documentRef: snapshot.documentRef,
                revision: snapshot.revision,
                cleanupCandidate: true,
              },
            })
          }
        }
        throw error
      }
      const materialization = createMaterialization(snapshot, result)
      return materialization
    },
    rollbackMaterialization,
    finalizeMaterialization,
  }
}
