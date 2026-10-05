import type { ImageEditDocumentProjectionBindingV3 } from '@/features/imageEdit/v3/application/imageEditDocumentBindings'
import { getCanvasProjectInstance } from './canvasProjectInstances'
import { readAllCanvasProjects } from './canvasQueryService'
import { createMultiLayerDocumentPersistenceConfirmation } from './multiLayerDocumentPersistenceConfirmation'
import { isEditableLayerStackResultNode } from '../domain/canvasNodeGuards'
import { createCanvasEditV3SessionReference } from '../imageEditV3/canvasEditV3Session'

/** 当前节点关系优先于磁盘；历史引用只保活，不是当前预览的写入目标。 */
export async function resolveCanvasImageEditDocumentProjection(documentId: string): Promise<ImageEditDocumentProjectionBindingV3 | undefined> {
  const documentRef = `image-edit-v3:${documentId}` as const
  const projects = await readAllCanvasProjects()
  const targets = projects.flatMap((project) => project.nodes
    .filter(isEditableLayerStackResultNode)
    .filter((node) => node.data.imageEditSession?.documentRef === documentRef)
    .map((node) => ({ projectId: project.id, nodeId: node.id, session: node.data.imageEditSession! })))
  if (targets.length === 0) return undefined
  if (targets.length > 1) throw new Error('DOCUMENT_TARGET_CONFLICT：图片文档关联了多个画布节点，无法确定原保存目标')
  const target = targets[0]
  await getCanvasProjectInstance(target.projectId)
  const confirmation = createMultiLayerDocumentPersistenceConfirmation({ ...target, documentRef })
  return { projection: confirmation.projection,
    confirmProjection: (reference) => confirmation.confirm(createCanvasEditV3SessionReference(target.session.sourceUrl, reference)) }
}
