import { vi } from 'vitest'
import { ImageEditorV3CommandRepository } from '@/commands/imageEditorV3'
import { getPlatform } from '@/platform/runtime'
import { createImageEditDocumentV3, createImageEditEffectLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { ImageEditCommandBusV3 } from '@/features/imageEdit/v3/application/imageEditCommandBus'
import { registerImageEditV3LiveSession } from '@/features/imageEdit/v3/application/imageEditLiveSessionRegistry'
import { ImageMarkV3PersistenceQueue } from '@/features/imageMark/standalone/imageMarkV3Persistence'
import { createMultiLayerDocumentNodeApplicationService } from '@/features/canvas/application/multiLayerDocumentNodeApplicationService'
import type { MultiLayerDocumentNodePort } from '@/features/canvas/application/multiLayerDocumentNodeApplicationContracts'
import { createMultiLayerDocumentProjectionCanvasPort } from '@/features/canvas/application/multiLayerDocumentNodeCanvasAdapter'
import { createMultiLayerDocumentPersistenceConfirmation } from '@/features/canvas/application/multiLayerDocumentPersistenceConfirmation'
import { confirmCanvasPersistence } from '@/features/canvas/application/canvasPersistenceService'
import { CANVAS_NODE_TYPES } from '@/features/canvas/domain/canvasNodes'
import { createCanvasEditV3SessionReference } from '@/features/canvas/imageEditV3/canvasEditV3Session'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore } from '@/stores/projectStore'
import { readHarnessImageEditDocument } from './harnessNativeStorage'

/** GPU/编码/资源主进程端口是已知图像夹具；确认器、物化编排、节点 CAS 与存储链均为生产实现。 */
export async function createAttachedImageEditPersistenceFixture() {
  useCanvasStore.getState().setCanvasData([], [], { past: [], future: [] })
  useProjectStore.setState({ projects: [], currentProject: null, currentProjectId: null, isHydrated: true })
  const projectId = await useProjectStore.getState().createProject('附着图片保存夹具')
  const document = createImageEditDocumentV3({ width: 8, height: 8, documentId: 'attached-durable' })
  document.layers = [createImageEditEffectLayerV3('effect', '模糊', 'image.gaussian-blur-v2', { radius: 8 })]
  const bus = new ImageEditCommandBusV3(document)
  const repository = new ImageEditorV3CommandRepository()
  const initial = await repository.save(document, { expectedRevision: 0, history: bus.getPersistenceSnapshot().history })
  const initialSession = { kind: 'image-edit-v3' as const, documentRef: 'image-edit-v3:attached-durable' as const,
    revision: 0, previewRef: null, sourceUrl: 'henji-media://fixture/initial.png' }
  useCanvasStore.getState().setCanvasData([{ id: 'attached-node', type: CANVAS_NODE_TYPES.layerStackResult,
    position: { x: 0, y: 0 }, data: { resultKind: 'layer-stack', imageUrl: initialSession.sourceUrl,
      previewImageUrl: initialSession.sourceUrl, imageEditSession: initialSession, aspectRatio: '1:1' } }], [], { past: [], future: [] })
  await confirmCanvasPersistence(projectId)
  const previewRef = `sha256:${'a'.repeat(64)}` as const
  const mediaUrl = `henji-media://image-editor-v3/${'a'.repeat(64)}?mediaType=image%2Fpng`
  const unavailable = async (): Promise<never> => { throw new Error('夹具没有实现此图像主进程入口') }
  const materialize: MultiLayerDocumentNodePort['saveAndMaterialize'] = vi.fn(async ({ session }) => {
    const saved = readHarnessImageEditDocument(document.id)!
    await getPlatform().imageEditorV3.saveDocument({ ...saved, requestId: 'fixture-pixel-materialization', expectedRevision: saved.document.revision, previewRef })
    return { projection: { imageEditSession: { ...session, sourceUrl: mediaUrl, previewRef }, imageUrl: mediaUrl,
      previewImageUrl: mediaUrl, aspectRatio: '1:1' }, rollback: { documentRef: session.documentRef,
      revision: session.revision, sourceFingerprint: `sha256:${'b'.repeat(64)}` as const, previousPreviewRef: saved.previewRef ?? null, installedPreviewRef: previewRef } }
  })
  const documentPort: MultiLayerDocumentNodePort = { createFromLayerStack: unavailable, inspectDocument: unavailable,
    saveAndMaterialize: materialize, rollbackMaterialization: unavailable, finalizeMaterialization: async () => true,
    forkDocument: unavailable, markReleaseCandidate: unavailable, materializeExportTarget: unavailable, releaseExportRaster: unavailable }
  const service = createMultiLayerDocumentNodeApplicationService({ documentPort,
    canvasPort: { ...createMultiLayerDocumentProjectionCanvasPort({ releaseReplacedLocalImages: async () => undefined }), createExportedImageNode: unavailable } })
  const confirmation = createMultiLayerDocumentPersistenceConfirmation({ projectId, nodeId: 'attached-node', documentRef: initialSession.documentRef }, {
    saveProjection: service.saveMaterializedProjection,
  })
  const queue = new ImageMarkV3PersistenceQueue({ repository, initialReference: initial, initialHistory: bus.getPersistenceSnapshot().history })
  const dispose = registerImageEditV3LiveSession('attached-session', bus, { getQueue: () => queue,
    projection: confirmation.projection,
    confirmProjection: (reference) => confirmation.confirm(createCanvasEditV3SessionReference(initialSession.sourceUrl, reference)) })
  return { bus, projectId, document, queue, confirmation, materialize, dispose }
}
