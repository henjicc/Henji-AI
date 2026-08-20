import { createLogger } from '@/core/logging'
import { resolveMediaFileKind, type CanvasMediaKind } from '@/features/canvas/canvasUtils'
import {
  CANVAS_NODE_TYPES,
  type AudioMediaNodeData,
  type UploadImageNodeData,
  type UploadPlaceholderResolution,
  type VideoMediaNodeData,
} from '@/features/canvas/domain/canvasNodes'
import { importLocalMedia } from '@/services/localMediaImport'

const logger = createLogger('features.canvas.application.mediaImport')

export type CanvasMediaImportResult = UploadPlaceholderResolution & {
  kind: CanvasMediaKind
}

export type CanvasMediaFileValidation =
  | { accepted: true; kind: CanvasMediaKind }
  | { accepted: false; reason: 'unsupported' | 'typeMismatch' }

export function validateCanvasMediaFile(
  file: Pick<File, 'name' | 'type'>,
  requiredKind?: CanvasMediaKind | null,
): CanvasMediaFileValidation {
  const kind = resolveMediaFileKind(file)
  if (!kind) {
    return { accepted: false, reason: 'unsupported' }
  }
  if (requiredKind && requiredKind !== kind) {
    return { accepted: false, reason: 'typeMismatch' }
  }
  return { accepted: true, kind }
}

export class UnsupportedCanvasMediaError extends Error {
  constructor() {
    super('Unsupported canvas media file')
    this.name = 'UnsupportedCanvasMediaError'
  }
}

export async function importCanvasMediaFile(file: File): Promise<CanvasMediaImportResult> {
  const kind = resolveMediaFileKind(file)
  if (!kind) {
    throw new UnsupportedCanvasMediaError()
  }

  const startedAt = performance.now()
  try {
    const imported = await importLocalMedia(file, kind)
    if (imported.kind === 'image') {
      const data: Partial<UploadImageNodeData> = {
        imageUrl: imported.fullPath,
        previewImageUrl: imported.previewPath,
        aspectRatio: imported.aspectRatio || '1:1',
        sourceFileName: file.name,
      }
      return { kind, type: CANVAS_NODE_TYPES.upload, data }
    }

    if (imported.kind === 'video') {
      const data: Partial<VideoMediaNodeData> = {
        videoUrl: imported.fullPath,
        previewImageUrl: imported.posterPath,
        aspectRatio: imported.aspectRatio,
        durationSec: imported.durationSeconds,
        hasAudio: imported.hasAudio,
        sourceFileName: file.name,
      }
      return { kind, type: CANVAS_NODE_TYPES.videoUpload, data }
    }

    const data: Partial<AudioMediaNodeData> = {
      audioUrl: imported.fullPath,
      durationSec: imported.durationSeconds,
      sourceFileName: file.name,
    }
    return { kind, type: CANVAS_NODE_TYPES.audioUpload, data }
  } catch (error) {
    logger.error(
      `媒体导入失败 kind=${kind} name="${file.name}" size=${file.size}B elapsed=${Math.round(performance.now() - startedAt)}ms`,
      error,
    )
    throw error
  }
}
