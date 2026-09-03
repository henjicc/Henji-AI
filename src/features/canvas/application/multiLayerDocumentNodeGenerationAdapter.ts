import {
  deleteImageEditorV3DocumentIfRevision,
  ImageEditorV3CommandRepository,
  loadImageEditorV3Document,
} from '@/commands/imageEditorV3'
import { createLogger } from '@/core/logging'
import { ImageEditCommandHistoryV3 } from '@/core/imageEdit/v3/commandHistory'
import { createImageEditRenderHash } from '@/core/imageEdit/v3/renderHash'
import { getPlatform } from '@/platform/runtime'

import type { LayerStackDocumentV1 } from '../domain/layerStack'
import type { ImageEditSessionReferenceV3 } from '@/core/imageEdit/v3/sessionReference'
import type { LayerStackResultNodeData } from '../domain/canvasNodeData'
import {
  createCanvasEditV3SessionReference,
} from '../imageEditV3/canvasEditV3Session'
import { importLayerStackV1AsImageEditDocumentV3 } from '../imageEditV3/layerStackV1Adapter'
import { createMultiLayerDocumentExportPort } from '../imageEditV3/multiLayerDocumentExportAdapter'
import { createMultiLayerDocumentProjectionPort } from '../imageEditV3/multiLayerDocumentProjectionAdapter'
import type {
  MultiLayerDocumentNodeCanvasPort,
  MultiLayerDocumentNodePort,
  MultiLayerDocumentNodeProjection,
} from './multiLayerDocumentNodeApplicationContracts'
import { createMultiLayerDocumentNodeApplicationService } from './multiLayerDocumentNodeApplicationService'
import { createMultiLayerDocumentProjectionCanvasPort } from './multiLayerDocumentNodeCanvasAdapter'

const logger = createLogger('features.canvas.multi_layer_document_generation')

interface GenerationDocumentPortDependencies {
  repository?: Pick<ImageEditorV3CommandRepository, 'save'>
  importDocument?: typeof importLayerStackV1AsImageEditDocumentV3
  collectGarbage?: () => Promise<void>
}

function documentIdFromRef(documentRef: ImageEditSessionReferenceV3['documentRef']): string {
  return documentRef.slice('image-edit-v3:'.length)
}

export async function inspectMultiLayerDocumentSession(input: {
  session: ImageEditSessionReferenceV3
  signal?: AbortSignal
}, dependencies: {
  loadSnapshot?: typeof loadImageEditorV3Document
} = {}): Promise<ImageEditSessionReferenceV3> {
  const loadSnapshot = dependencies.loadSnapshot ?? loadImageEditorV3Document
  const snapshot = await loadSnapshot({
    requestId: `image-editor-v3:multi-layer-document-open:${crypto.randomUUID()}`,
    documentRef: input.session.documentRef,
  }, input.signal)
  const expectedDocumentId = documentIdFromRef(input.session.documentRef)
  if (!snapshot) throw new Error('多图层图片文档不存在')
  if (
    snapshot.documentRef !== input.session.documentRef
    || snapshot.document.id !== expectedDocumentId
    || snapshot.revision !== input.session.revision
    || snapshot.document.revision !== input.session.revision
    || snapshot.previewRef !== input.session.previewRef
  ) {
    throw new Error('多图层图片文档版本与节点记录不一致')
  }
  return input.session
}

function requireReadyPath(document: LayerStackDocumentV1, resourceId: string | null, label: string): string {
  const resource = document.resources.find((candidate) => candidate.resourceId === resourceId)
  if (!resource || resource.status !== 'ready' || !resource.filePath) {
    throw new Error(`图层栈缺少可用的${label}`)
  }
  return resource.filePath
}

export function createLayerStackV3DocumentId(nodeId: string, stackId: string): string {
  return `layer-stack-${createImageEditRenderHash({ nodeId, stackId })}`
}

export async function createLayerStackV3Projection(
  input: { nodeId: string; document: LayerStackDocumentV1; signal?: AbortSignal },
  dependencies: GenerationDocumentPortDependencies = {},
): Promise<MultiLayerDocumentNodeProjection> {
  const documentId = createLayerStackV3DocumentId(input.nodeId, input.document.stackId)
  const compositePath = requireReadyPath(
    input.document,
    input.document.compositeResourceId,
    '合成图',
  )
  const previewPath = requireReadyPath(
    input.document,
    input.document.thumbnailResourceId,
    '预览图',
  )
  const importDocument = dependencies.importDocument ?? importLayerStackV1AsImageEditDocumentV3
  const imported = await importDocument({
    document: input.document,
    documentId,
    signal: input.signal,
  })
  const history = new ImageEditCommandHistoryV3()
  history.clear(imported.document)
  const repository = dependencies.repository ?? new ImageEditorV3CommandRepository()
  try {
    const reference = await repository.save(imported.document, {
      expectedRevision: 0,
      previewRef: null,
      history: history.createSnapshot(),
      signal: input.signal,
    })
    return {
      imageEditSession: createCanvasEditV3SessionReference(compositePath, reference),
      imageUrl: compositePath,
      previewImageUrl: previewPath,
      aspectRatio: `${input.document.canvas.width}:${input.document.canvas.height}`,
    }
  } catch (error) {
    const collectGarbage = dependencies.collectGarbage ?? (async () => {
      await getPlatform().imageEditorV3.collectGarbage({
        requestId: `image-editor-v3:layer-stack-create-rollback:${crypto.randomUUID()}`,
        retainedResourceRefs: [],
      })
    })
    await collectGarbage().catch((cleanupError) => {
      logger.error('图层栈初始文档资源补偿失败', cleanupError, {
        event: 'canvas.multi_layer_document.create.resource_rollback.failed',
        nodeId: input.nodeId,
        context: {
          documentId,
          resourceRefs: imported.resourceDescriptors.map((resource) => resource.resourceRef),
        },
      })
    })
    throw error
  }
}

function unavailable(operation: string): never {
  throw new Error(`多图层文档端口 ${operation} 尚未接入当前阶段`)
}

const generationDocumentPort: MultiLayerDocumentNodePort = {
  createFromLayerStack: createLayerStackV3Projection,
  inspectDocument: inspectMultiLayerDocumentSession,
  forkDocument: async () => unavailable('forkDocument'),
  markReleaseCandidate: async () => unavailable('markReleaseCandidate'),
  ...createMultiLayerDocumentProjectionPort(),
  ...createMultiLayerDocumentExportPort(),
}

const generationCanvasPort: MultiLayerDocumentNodeCanvasPort = {
  ...createMultiLayerDocumentProjectionCanvasPort(),
  createExportedImageNode: async () => unavailable('createExportedImageNode'),
}

const generationApplicationService = createMultiLayerDocumentNodeApplicationService({
  documentPort: generationDocumentPort,
  canvasPort: generationCanvasPort,
})

/** 新生成链路必须经过 1.1 冻结的唯一业务服务，不直接调用 V3 仓库。 */
export function createMultiLayerDocumentFromLayerStack(input: {
  nodeId: string
  document: LayerStackDocumentV1
  signal?: AbortSignal
}): Promise<MultiLayerDocumentNodeProjection> {
  return generationApplicationService.createFromLayerStack(input)
}

/** 完整编辑器只从节点权威 V3 投影打开，并先经过 1.1 的统一状态与版本校验。 */
export function openMultiLayerDocumentForEditing(input: {
  nodeId: string
  data: LayerStackResultNodeData
  signal?: AbortSignal
}): Promise<ImageEditSessionReferenceV3> {
  return generationApplicationService.openAndValidate(input)
}

/** 编辑器 flush 后只通过 1.1 唯一 application 服务完成整图物化与原节点 CAS。 */
export function saveMultiLayerDocumentAfterEditing(input: {
  projectId: string
  nodeId: string
  data: LayerStackResultNodeData
  session: ImageEditSessionReferenceV3
  signal?: AbortSignal
}): Promise<MultiLayerDocumentNodeProjection> {
  return generationApplicationService.saveMaterializedProjection(input)
}

export async function rollbackCreatedMultiLayerDocument(
  projection: MultiLayerDocumentNodeProjection,
): Promise<boolean> {
  const result = await deleteImageEditorV3DocumentIfRevision({
    requestId: `image-editor-v3:layer-stack-document-rollback:${crypto.randomUUID()}`,
    documentRef: projection.imageEditSession.documentRef,
    expectedRevision: projection.imageEditSession.revision,
  })
  if (!result.deleted) return false
  await getPlatform().imageEditorV3.collectGarbage({
    requestId: `image-editor-v3:layer-stack-resource-rollback:${crypto.randomUUID()}`,
    retainedResourceRefs: [],
  }).catch((error) => {
    logger.error('图层栈文档补偿后的资源回收失败', error, {
      event: 'canvas.multi_layer_document.rollback.resource_gc.failed',
      context: {
        documentRef: projection.imageEditSession.documentRef,
        revision: projection.imageEditSession.revision,
      },
    })
  })
  return true
}
