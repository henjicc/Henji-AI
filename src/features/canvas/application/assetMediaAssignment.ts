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

export function mediaSourceNodeData(payload: CanvasMediaSourcePayload): Partial<CanvasNodeData> {
  const sourceFileName = payload.displayName ?? payload.filePath.split(/[\\/]/).pop() ?? null
  if (payload.type === 'video') return { videoUrl: payload.filePath, previewImageUrl: payload.thumbnailUrl ?? null, aspectRatio: payload.aspectRatio ?? '1:1', durationSec: payload.durationSeconds ?? null, sourceFileName, isSizeManuallyAdjusted: false }
  if (payload.type === 'audio') return { audioUrl: payload.filePath, sourceFileName }
  return { imageUrl: payload.filePath, previewImageUrl: payload.thumbnailUrl ?? null, aspectRatio: payload.aspectRatio ?? '1:1', sourceFileName, isSizeManuallyAdjusted: false }
}
