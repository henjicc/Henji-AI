import { useCallback } from 'react'
import type { ReactFlowInstance } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { createLogger } from '@/core/logging'
import { readAssetDragPayload } from '@/features/assets/drag/assetDragPayload'
import type { CanvasEdge, CanvasNode, CanvasNodeData, CanvasNodeType } from '../domain/canvasNodes'
import { mediaSourceNodeData, mediaSourceNodeType } from '../application/assetMediaAssignment'
import { canvasEventBus } from '../application/canvasServices'
import { resolveMediaFiles } from '../canvasUtils'
import { useCanvasNodePresence } from '../presence/useCanvasNodePresence'
import { useCanvasSceneView } from '../scene/useCanvasScene'

const logger = createLogger('features.canvas.hooks.useCanvasAssetDrop')
const EXTERNAL_MEDIA_COLUMNS = 3
const EXTERNAL_MEDIA_COLUMN_GAP = 320
const EXTERNAL_MEDIA_ROW_GAP = 240

interface Options {
  reactFlowInstance: ReactFlowInstance<CanvasNode, CanvasEdge>
  addNode: (type: CanvasNodeType, position: { x: number; y: number }, data?: Partial<CanvasNodeData>) => string
  schedulePersist: (delayMs?: number) => void
}

export function useCanvasAssetDrop({ reactFlowInstance, addNode, schedulePersist }: Options): {
  onDragOver: (event: React.DragEvent) => void
  onDrop: (event: React.DragEvent) => void
} {
  const { t } = useTranslation()
  const sceneView = useCanvasSceneView()
  const presence = useCanvasNodePresence()
  const onDragOver = useCallback((event: React.DragEvent): void => {
    const isAssetDrag = event.dataTransfer.types.includes('application/x-henji-drag-data')
    const isExternalFileDrag = event.dataTransfer.types.includes('Files')
    if (!isAssetDrag && !isExternalFileDrag) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }, [])
  const onDrop = useCallback((event: React.DragEvent): void => {
    const payload = readAssetDragPayload(event.dataTransfer)
    if (payload) {
      event.preventDefault()
      addNode(mediaSourceNodeType(payload.type), reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY }), mediaSourceNodeData(payload))
      schedulePersist()
      return
    }

    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()

    // 节点自己的上传区会消费落在节点内的文件；画布级导入只处理空白区域，
    // 避免一次拖放既写入目标节点、又额外创建一个媒体节点。
    const targetElement = event.target as Element | null
    const targetNodeId = targetElement?.closest<HTMLElement>('.react-flow__node')?.dataset.id
    if (targetNodeId && presence.isBodyInteractive(targetNodeId)) return

    const mediaFiles = resolveMediaFiles(event.dataTransfer.files)
    // 落点上的节点没挂正文（远景，或还没轮到挂载）：它的上传区不在场，把文件按“导入到这个节点”交给它，
    // 能接收文件的节点会在挂上正文后处理，其余节点与落在自己上传区之外一样不处理。
    const dropNode = sceneView.hitNodeAtClient({ x: event.clientX, y: event.clientY })
    if (dropNode) {
      if (mediaFiles[0]) canvasEventBus.publish('canvas/import-media', { nodeId: dropNode.id, file: mediaFiles[0].file })
      return
    }

    const skippedCount = Math.max(0, event.dataTransfer.files.length - mediaFiles.length)
    if (mediaFiles.length === 0) {
      canvasEventBus.publish('canvas/toast', {
        message: t('canvas.mediaDrop.unsupported'),
        type: 'error',
      })
      return
    }

    logger.info('画布外部媒体拖入开始', {
      event: 'canvas.media_drop.start',
      fileCount: mediaFiles.length,
      skippedCount,
    })

    try {
      const basePosition = reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY })
      const imported = mediaFiles.map((media, index) => {
        const nodeId = addNode(mediaSourceNodeType(media.kind), {
          x: basePosition.x + (index % EXTERNAL_MEDIA_COLUMNS) * EXTERNAL_MEDIA_COLUMN_GAP,
          y: basePosition.y + Math.floor(index / EXTERNAL_MEDIA_COLUMNS) * EXTERNAL_MEDIA_ROW_GAP,
        })
        return { nodeId, file: media.file, kind: media.kind }
      })

      window.setTimeout(() => {
        imported.forEach(({ nodeId, file }) => {
          canvasEventBus.publish('canvas/import-media', { nodeId, file })
        })
      }, 0)
      schedulePersist(0)
      canvasEventBus.publish('canvas/toast', {
        message: skippedCount > 0
          ? t('canvas.mediaDrop.importedWithSkipped', { count: imported.length, skipped: skippedCount })
          : t('canvas.mediaDrop.imported', { count: imported.length }),
        type: 'success',
      })
      logger.info('画布外部媒体拖入完成', {
        event: 'canvas.media_drop.completed',
        fileCount: imported.length,
        skippedCount,
        mediaTypes: Array.from(new Set(imported.map((item) => item.kind))),
      })
    } catch (error) {
      logger.error('画布外部媒体拖入失败', error, {
        event: 'canvas.media_drop.failed',
        context: { fileCount: mediaFiles.length, skippedCount },
      })
      canvasEventBus.publish('canvas/toast', {
        message: t('canvas.mediaDrop.failed'),
        type: 'error',
      })
    }
  }, [addNode, presence, reactFlowInstance, sceneView, schedulePersist, t])
  return { onDragOver, onDrop }
}
