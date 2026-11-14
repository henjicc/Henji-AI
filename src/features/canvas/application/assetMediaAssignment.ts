import type { HenjiDragTransferData } from '@/contexts/dragDataTransfer'
import { CANVAS_NODE_TYPES, type CanvasNodeData, type CanvasNodeType } from '../domain/canvasNodes'

export interface CanvasMediaSourcePayload extends HenjiDragTransferData {
  filePath: string
}

export function mediaSourceNodeType(mediaType: CanvasMediaSourcePayload['type']): CanvasNodeType {
  if (mediaType === 'video') return CANVAS_NODE_TYPES.videoUpload
  if (mediaType === 'audio') return CANVAS_NODE_TYPES.audioUpload
  return CANVAS_NODE_TYPES.upload
}

/**
 * 拖入或放入画布的媒体只记原文件。来源带的缩略图（素材库、生成记录）在程序缩略图目录里，
 * 不写进节点：显示时按原文件取缓存缩略图；显式清空，换掉已有节点的媒体时不留下旧预览。
 */
export function mediaSourceNodeData(payload: CanvasMediaSourcePayload): Partial<CanvasNodeData> {
  const sourceFileName = payload.displayName ?? payload.filePath.split(/[\\/]/).pop() ?? null
  if (payload.type === 'video') return { videoUrl: payload.filePath, previewImageUrl: null, aspectRatio: payload.aspectRatio ?? '1:1', durationSec: payload.durationSeconds ?? null, sourceFileName, isSizeManuallyAdjusted: false }
  if (payload.type === 'audio') return { audioUrl: payload.filePath, sourceFileName }
  return { imageUrl: payload.filePath, previewImageUrl: null, aspectRatio: payload.aspectRatio ?? '1:1', sourceFileName, isSizeManuallyAdjusted: false }
}
