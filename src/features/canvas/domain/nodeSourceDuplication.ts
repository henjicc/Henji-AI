import type { CanvasNode } from './canvasNodes'
import { isEditableLayerStackResultNode } from './canvasNodeGuards'

/** 由应用服务提供 I/O；节点声明保持轻量，不反向加载文档组合根。 */
export interface CanvasNodeSourceServices {
  cameraStage: () => Promise<{
    duplicateCameraStageDocument: (id: string) => Promise<{ id: string; name: string } | null>
    rollbackDuplicatedCameraStageDocument: (id: string) => Promise<void>
  }>
  layerStack: () => Promise<Pick<typeof import('../application/multiLayerDocumentNodeGenerationAdapter'),
    'forkMultiLayerDocumentNode' | 'rollbackCreatedMultiLayerDocument'>>
}

export interface CanvasNodeSourceCopy {
  data: Record<string, unknown>
  rollback: () => Promise<void>
}

export type CanvasNodeSourceDuplicator = (
  source: CanvasNode, services: CanvasNodeSourceServices,
) => Promise<CanvasNodeSourceCopy | null>

export const duplicateCameraStageNodeSource: CanvasNodeSourceDuplicator = async (source, services) => {
  const projectId = source.data.projectId
  if (projectId === null || projectId === undefined) return null
  if (typeof projectId !== 'string' || !projectId) throw new Error('镜头参考来源文档无效，无法复制节点')
  const documents = await services.cameraStage()
  const copied = await documents.duplicateCameraStageDocument(projectId)
  if (!copied) throw new Error('镜头参考来源文档不存在，无法复制节点')
  if (copied.id === projectId) throw new Error('镜头参考复制未产生独立文档，无法复制节点')
  return {
    data: { projectId: copied.id },
    rollback: () => documents.rollbackDuplicatedCameraStageDocument(copied.id),
  }
}

export const duplicateLayerStackNodeSource: CanvasNodeSourceDuplicator = async (source, services) => {
  if (!isEditableLayerStackResultNode(source)) return null
  const documents = await services.layerStack()
  const projection = await documents.forkMultiLayerDocumentNode({
    sourceNodeId: source.id, targetNodeId: crypto.randomUUID(), data: source.data,
  })
  return {
    data: {
      resultKind: 'layer-stack',
      imageEditSession: projection.imageEditSession,
      imageUrl: projection.imageUrl,
      previewImageUrl: projection.previewImageUrl,
      aspectRatio: projection.aspectRatio,
    },
    rollback: async () => {
      if (!await documents.rollbackCreatedMultiLayerDocument(projection)) {
        throw new Error('复制图层来源的补偿未完成')
      }
    },
  }
}
