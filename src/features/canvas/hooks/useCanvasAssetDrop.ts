import { useCallback } from 'react'
import type { ReactFlowInstance } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { createLogger } from '@/core/logging'
import { readAssetDragPayload } from '@/features/assets/drag/assetDragPayload'
import type { CanvasEdge, CanvasNode, CanvasNodeData, CanvasNodeType } from '../domain/canvasNodes'
import { assetSourceNodeData, assetSourceNodeType } from '../application/assetMediaAssignment'
import { canvasEventBus } from '../application/canvasServices'
import { resolveMediaFiles } from '../canvasUtils'

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
      addNode(assetSourceNodeType(payload.type), reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY }), assetSourceNodeData(payload))
      schedulePersist()
      return
    }

    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()

    // 节点自己的上传区会消费落在节点内的文件；画布级导入只处理空白区域，
    // 避免一次拖放既写入目标节点、又额外创建一个媒体节点。
    const targetElement = event.target as Element | null
    if (targetElement?.closest('.react-flow__node')) return

    const mediaFiles = resolveMediaFiles(event.dataTransfer.files)
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
        const nodeId = addNode(assetSourceNodeType(media.kind), {
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
  }, [addNode, reactFlowInstance, schedulePersist, t])
  return { onDragOver, onDrop }
}
