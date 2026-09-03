import { createLogger } from '@/core/logging'
import type { ImageEditSessionReferenceV3 } from '@/core/imageEdit/v3/sessionReference'
import { isLikelyLocalImagePath } from '@/services/imageSource'
import { getPlatform } from '@/platform/runtime'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore } from '@/stores/projectStore'

import { isLayerStackResultNode } from '../domain/canvasNodeGuards'
import { parseMultiLayerDocumentNodeState } from '../domain/multiLayerDocumentNode'
import { persistCanvasState } from './canvasApplicationService'
import { runCanvasTransaction } from './canvasBatchService'
import {
  MULTI_LAYER_NODE_PROJECTION_HISTORY_POLICY,
  MultiLayerDocumentNodeApplicationError,
  type MultiLayerDocumentNodeCanvasPort,
} from './multiLayerDocumentNodeApplicationContracts'

const logger = createLogger('features.canvas.multi_layer_document_projection_cas')

interface CanvasAdapterDependencies {
  releaseReplacedLocalImages?: (filePaths: string[]) => Promise<void>
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

export type MultiLayerDocumentProjectionCanvasPort = Pick<
  MultiLayerDocumentNodeCanvasPort,
  'commitMaterializedProjection' | 'commitLegacyMigration'
>

export type MultiLayerDocumentExportCanvasPort = Pick<
  MultiLayerDocumentNodeCanvasPort,
  'createExportedImageNode'
>

/**
 * 独立导出的唯一画布事务：沿用派生节点布局，原子创建普通图片节点和源连线。
 * 编辑器是当前工作表面，成功或失败都恢复原选择与弹窗，不把导出误当成关闭操作。
 */
export function createMultiLayerDocumentExportCanvasPort(): MultiLayerDocumentExportCanvasPort {
  return {
    async createExportedImageNode(input) {
      const project = useProjectStore.getState()
      if (project.currentProjectId !== input.projectId || project.currentProject?.id !== input.projectId) {
        throw new MultiLayerDocumentNodeApplicationError(
          'DOCUMENT_CONFLICT',
          '当前画布项目已经切换，请返回原项目后重试',
          true,
        )
      }
      const before = useCanvasStore.getState()
      const activeToolDialog = before.activeToolDialog
      const selectedNodeId = before.selectedNodeId
      try {
        let nodeId = ''
        let edgeId = ''
        const transaction = await runCanvasTransaction(input.projectId, 2, async () => {
          const canvas = useCanvasStore.getState()
          if (!canvas.nodes.some((node) => node.id === input.sourceNodeId)) {
            throw new MultiLayerDocumentNodeApplicationError(
              'DOCUMENT_CONFLICT',
              '多图层文档节点已被删除',
              true,
            )
          }
          const createdNodeId = canvas.addDerivedExportNode(
            input.sourceNodeId,
            input.raster.imageUrl,
            input.raster.aspectRatio,
            input.raster.previewImageUrl,
            {
              defaultTitle: input.raster.displayName,
              resultKind: 'image',
            },
          )
          if (!createdNodeId) throw new Error('无法创建多图层文档导出节点')
          nodeId = createdNodeId
          const createdEdgeId = useCanvasStore.getState().addEdge(input.sourceNodeId, nodeId)
          if (!createdEdgeId) throw new Error('无法创建多图层文档导出连线')
          edgeId = createdEdgeId
          useCanvasStore.setState({ selectedNodeId, activeToolDialog })
          return [{ nodeId }, { edgeId }]
        }, {
          operation: 'multi_layer_document.export_target',
          sourceNodeId: input.sourceNodeId,
          targetKind: input.target.kind,
        })
        return { nodeId, edgeId, undoRef: transaction.undoRef }
      } finally {
        useCanvasStore.setState({ selectedNodeId, activeToolDialog })
      }
    },
  }
}

/**
 * 同一节点投影的唯一 CAS：同步比较项目、节点和旧会话，再一次替换节点 data。
 * V3 文档已经保存自己的历史，因此这里刻意不触碰画布 history。
 */
export function createMultiLayerDocumentProjectionCanvasPort(
  dependencies: CanvasAdapterDependencies = {},
): MultiLayerDocumentProjectionCanvasPort {
  const releaseReplacedLocalImages = dependencies.releaseReplacedLocalImages
    ?? ((filePaths) => getPlatform().image.releaseLayerStackResources(filePaths))

  return {
    async commitLegacyMigration(input): Promise<'committed' | 'already-committed'> {
      if (input.historyPolicy !== MULTI_LAYER_NODE_PROJECTION_HISTORY_POLICY) {
        throw new MultiLayerDocumentNodeApplicationError(
          'INVALID_INPUT',
          '旧版迁移投影必须跳过画布历史',
          false,
        )
      }
      const project = useProjectStore.getState()
      if (project.currentProjectId !== input.projectId || project.currentProject?.id !== input.projectId) {
        throw new MultiLayerDocumentNodeApplicationError(
          'DOCUMENT_CONFLICT',
          '当前画布项目已经切换，请返回原项目后重试',
          true,
        )
      }
      let status: 'committed' | 'already-committed' | null = null
      useCanvasStore.setState((state) => {
        const index = state.nodes.findIndex((node) => node.id === input.nodeId)
        if (index < 0) return {}
        const node = state.nodes[index]
        if (!isLayerStackResultNode(node)) return {}
        const parsed = parseMultiLayerDocumentNodeState(node.data)
        if (parsed.kind === 'editable-v3') {
          if (sameSession(parsed.session, input.projection.imageEditSession)) {
            status = 'already-committed'
          }
          return {}
        }
        if (
          parsed.kind !== 'legacy-v1-pending-migration'
          || JSON.stringify(parsed.document) !== JSON.stringify(input.expectedDocument)
        ) return {}
        const nodes = [...state.nodes]
        nodes[index] = {
          ...node,
          data: {
            ...node.data,
            resultKind: 'layer-stack',
            imageEditSession: input.projection.imageEditSession,
            imageUrl: input.projection.imageUrl,
            previewImageUrl: input.projection.previewImageUrl,
            aspectRatio: input.projection.aspectRatio,
          },
        }
        status = 'committed'
        return { nodes }
      })
      if (!status) {
        throw new MultiLayerDocumentNodeApplicationError(
          'DOCUMENT_CONFLICT',
          '旧版图层节点已被删除或修改，请重试',
          true,
        )
      }
      if (status === 'committed') persistCanvasState()
      return status
    },

    async commitMaterializedProjection(input): Promise<void> {
      if (input.historyPolicy !== MULTI_LAYER_NODE_PROJECTION_HISTORY_POLICY) {
        throw new MultiLayerDocumentNodeApplicationError(
          'INVALID_INPUT',
          '多图层文档投影必须跳过画布历史',
          false,
        )
      }
      const project = useProjectStore.getState()
      if (
        project.currentProjectId !== input.projectId
        || project.currentProject?.id !== input.projectId
      ) {
        throw new MultiLayerDocumentNodeApplicationError(
          'DOCUMENT_CONFLICT',
          '当前画布项目已经切换，请返回原项目后重试',
          true,
        )
      }

      let committed = false
      let conflictMessage = '多图层文档节点已被删除'
      let replacedImageUrl: string | null = null
      let replacedPreviewImageUrl: string | null = null
      useCanvasStore.setState((state) => {
        const nodeIndex = state.nodes.findIndex((node) => node.id === input.nodeId)
        if (nodeIndex < 0) return {}
        const node = state.nodes[nodeIndex]
        if (!isLayerStackResultNode(node)) {
          conflictMessage = '目标节点已经不是多图层图片文档'
          return {}
        }
        let currentSession: ImageEditSessionReferenceV3
        try {
          const current = parseMultiLayerDocumentNodeState(node.data)
          if (current.kind !== 'editable-v3') {
            conflictMessage = '多图层文档节点当前不再可编辑'
            return {}
          }
          currentSession = current.session
        } catch {
          conflictMessage = '多图层文档节点状态已经变化'
          return {}
        }
        if (!sameSession(currentSession, input.expectedSession)) {
          conflictMessage = '多图层文档节点已被其他操作更新，请重新打开后再试'
          return {}
        }

        replacedImageUrl = typeof node.data.imageUrl === 'string' ? node.data.imageUrl : null
        replacedPreviewImageUrl = typeof node.data.previewImageUrl === 'string'
          ? node.data.previewImageUrl
          : null
        const nodes = [...state.nodes]
        nodes[nodeIndex] = {
          ...node,
          data: {
            ...node.data,
            imageEditSession: input.projection.imageEditSession,
            imageUrl: input.projection.imageUrl,
            previewImageUrl: input.projection.previewImageUrl,
            aspectRatio: input.projection.aspectRatio,
            resultKind: 'layer-stack',
          },
        }
        committed = true
        return { nodes }
      })

      if (!committed) {
        throw new MultiLayerDocumentNodeApplicationError(
          'DOCUMENT_CONFLICT',
          conflictMessage,
          true,
        )
      }
      persistCanvasState()

      const replacedSources: Array<string | null> = [
        replacedImageUrl,
        replacedPreviewImageUrl,
      ]
      const replacedLocalImages = [...new Set(replacedSources.filter((source): source is string => (
        typeof source === 'string'
        && source !== input.projection.imageUrl
        && source !== input.projection.previewImageUrl
        && isLikelyLocalImagePath(source)
      )))]
      if (replacedLocalImages.length === 0) return
      await releaseReplacedLocalImages(replacedLocalImages).catch((error) => {
        logger.error('旧多图层节点平面资源释放失败', error, {
          event: 'canvas.multi_layer_document.projection.replaced_resource_release.failed',
          projectId: input.projectId,
          nodeId: input.nodeId,
          context: {
            cleanupCandidate: true,
            resourceCount: replacedLocalImages.length,
          },
        })
      })
    },
  }
}
