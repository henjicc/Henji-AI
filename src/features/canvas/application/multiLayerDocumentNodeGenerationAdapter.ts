import {
  deleteImageEditorV3DocumentIfRevision,
  ImageEditorV3CommandRepository,
  loadImageEditorV3Document,
} from '@/commands/imageEditorV3'
import { createLogger } from '@/core/logging'
import type { ApplicationRef } from '@/core/application-control'
import { ImageEditCommandHistoryV3 } from '@/core/imageEdit/v3/commandHistory'
import { createImageEditRenderHash } from '@/core/imageEdit/v3/renderHash'
import { getPlatform } from '@/platform/runtime'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore } from '@/stores/projectStore'

import type { LayerStackDocumentV1 } from '../domain/layerStack'
import type { ImageEditSessionReferenceV3 } from '@/core/imageEdit/v3/sessionReference'
import type { LayerStackResultNodeData } from '../domain/canvasNodeData'
import { isEditableLayerStackResultNode } from '../domain/canvasNodeGuards'
import type { MultiLayerDocumentExportTarget } from '../domain/multiLayerDocumentNode'
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
import {
  createMultiLayerDocumentExportCanvasPort,
  createMultiLayerDocumentProjectionCanvasPort,
} from './multiLayerDocumentNodeCanvasAdapter'

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
  ...createMultiLayerDocumentExportCanvasPort(),
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

type ExportSessionPreparer = () => Promise<ImageEditSessionReferenceV3>

interface ExportSessionRegistration {
  token: symbol
  prepare: ExportSessionPreparer
}

const exportSessionPreparers = new Map<string, ExportSessionRegistration>()
const pendingExports = new Map<string, Promise<MultiLayerDocumentTargetExportResult>>()

export interface MultiLayerDocumentTargetExportInput {
  projectRef: ApplicationRef & { kind: 'canvas.project' }
  sourceNodeRef: ApplicationRef & { kind: 'canvas.node' }
  targetRef: ApplicationRef & {
    kind: 'image_edit.layer' | 'image_edit.group' | 'image_mark.annotation'
  }
  signal?: AbortSignal
}

export interface MultiLayerDocumentTargetExportResult {
  projectRef: ApplicationRef & { kind: 'canvas.project' }
  sourceNodeRef: ApplicationRef & { kind: 'canvas.node' }
  targetRef: MultiLayerDocumentTargetExportInput['targetRef']
  nodeRef: ApplicationRef & { kind: 'canvas.node' }
  edgeRef: ApplicationRef & { kind: 'canvas.edge' }
  undoRef: string
  width: number
  height: number
  mediaType: 'image/png'
}

/** 编辑器登记实时保存入口；助手和 UI 随后都走同一导出函数。 */
export function registerMultiLayerDocumentExportSession(
  sourceNodeId: string,
  prepare: ExportSessionPreparer,
): () => void {
  const token = Symbol(sourceNodeId)
  exportSessionPreparers.set(sourceNodeId, { token, prepare })
  return () => {
    if (exportSessionPreparers.get(sourceNodeId)?.token === token) {
      exportSessionPreparers.delete(sourceNodeId)
    }
  }
}

function exportTargetFromRef(
  ref: MultiLayerDocumentTargetExportInput['targetRef'],
): MultiLayerDocumentExportTarget {
  if (ref.kind === 'image_edit.group') {
    return { kind: 'layer-group', ref: { ...ref, kind: 'image_edit.group' } }
  }
  if (ref.kind === 'image_mark.annotation') {
    return { kind: 'annotation-element', ref: { ...ref, kind: 'image_mark.annotation' } }
  }
  return { kind: 'raster-layer', ref: { ...ref, kind: 'image_edit.layer' } }
}

/** UI 与助手共享的唯一导出入口；同一 pending 目标复用 Promise，完成后再次调用仍会新建节点。 */
export function exportMultiLayerDocumentTargetToCanvas(
  input: MultiLayerDocumentTargetExportInput,
): Promise<MultiLayerDocumentTargetExportResult> {
  const key = `${input.projectRef.id}\u0000${input.sourceNodeRef.id}\u0000${input.targetRef.kind}\u0000${input.targetRef.id}`
  const pending = pendingExports.get(key)
  if (pending) return pending
  const operation: Promise<MultiLayerDocumentTargetExportResult> = (async (): Promise<MultiLayerDocumentTargetExportResult> => {
    if (input.projectRef.kind !== 'canvas.project' || input.sourceNodeRef.kind !== 'canvas.node') {
      throw new Error('多图层文档导出的项目或节点引用无效')
    }
    const project = useProjectStore.getState()
    if (
      project.currentProjectId !== input.projectRef.id
      || project.currentProject?.id !== input.projectRef.id
    ) {
      throw new Error('当前画布项目已经切换，请返回原项目后重试')
    }
    const node = useCanvasStore.getState().nodes.find((candidate) => candidate.id === input.sourceNodeRef.id)
    if (!isEditableLayerStackResultNode(node)) {
      throw new Error('目标节点不是可编辑的多图层图片文档')
    }
    const prepare = exportSessionPreparers.get(node.id)?.prepare
    const session = prepare ? await prepare() : undefined
    const exported = await generationApplicationService.exportTarget({
      projectId: input.projectRef.id,
      sourceNodeId: node.id,
      data: node.data,
      session,
      target: exportTargetFromRef(input.targetRef),
      signal: input.signal,
    })
    return {
      projectRef: input.projectRef,
      sourceNodeRef: input.sourceNodeRef,
      targetRef: input.targetRef,
      nodeRef: { kind: 'canvas.node' as const, id: exported.nodeId },
      edgeRef: { kind: 'canvas.edge' as const, id: exported.edgeId },
      undoRef: exported.undoRef,
      width: exported.raster.width,
      height: exported.raster.height,
      mediaType: exported.raster.mediaType,
    }
  })()
  pendingExports.set(key, operation)
  void operation.finally(() => {
    if (pendingExports.get(key) === operation) pendingExports.delete(key)
  }).catch(() => undefined)
  return operation
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
