import { createLogger } from '@/core/logging'
import type { ImageEditSessionReferenceV3 } from '@/core/imageEdit/v3/sessionReference'
import { isLikelyLocalImagePath } from '@/services/imageSource'
import { getPlatform } from '@/platform/runtime'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore } from '@/stores/projectStore'

import { isLayerStackResultNode } from '../domain/canvasNodeGuards'
import { parseMultiLayerDocumentNodeState } from '../domain/multiLayerDocumentNode'
import { persistCanvasState } from './canvasApplicationService'
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
  'commitMaterializedProjection'
>

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
