import { createLogger } from '@/core/logging'
import type { ImageEditorManagedViewportCompositeV3 } from './viewportCompositeTypesV3'

const logger = createLogger('image_editor_v3.viewport_composite')

export interface ImageEditorViewportCompositeTimingV3 {
  requestId: string
  documentId: string
  revision: number
  phase: 'coarse' | 'analysis' | 'target' | undefined
  coverage: 'viewport' | 'document' | undefined
  startedAt: number
  sourceReadyAt: number | null
  workerStartedAt: number | null
}

export function imageEditorViewportCompositeTimingV3(source: {
  requestId: string
  document: { id: string; revision: number }
  phase?: 'coarse' | 'analysis' | 'target'
  coverage?: 'viewport' | 'document'
  startedAt: number
  sourceReadyAt: number | null
  workerStartedAt: number | null
}): ImageEditorViewportCompositeTimingV3 {
  return {
    requestId: source.requestId,
    documentId: source.document.id,
    revision: source.document.revision,
    phase: source.phase,
    coverage: source.coverage,
    startedAt: source.startedAt,
    sourceReadyAt: source.sourceReadyAt,
    workerStartedAt: source.workerStartedAt,
  }
}

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

export function logImageEditorViewportCompositeStartV3(
  timing: ImageEditorViewportCompositeTimingV3,
): void {
  logger.info('开始图片编辑 V3 视口分块合成', {
    event: 'image_editor_v3.viewport_composite.start',
    requestId: timing.requestId,
    context: {
      documentId: timing.documentId,
      revision: timing.revision,
      phase: timing.phase,
      coverage: timing.coverage,
    },
  })
}

export function logImageEditorViewportCompositeCompletedV3(
  timing: ImageEditorViewportCompositeTimingV3,
  result: ImageEditorManagedViewportCompositeV3,
): void {
  const endedAt = now()
  logger.info('完成图片编辑 V3 视口分块合成', {
    event: 'image_editor_v3.viewport_composite.completed',
    requestId: timing.requestId,
    context: {
      documentId: timing.documentId,
      revision: result.revision,
      phase: timing.phase,
      coverage: timing.coverage,
      mip: result.mip,
      tileCount: result.tiles.length,
      sourceLoadMs: timing.sourceReadyAt === null
        ? null
        : Math.max(0, Math.round(timing.sourceReadyAt - timing.startedAt)),
      workerQueueMs: timing.sourceReadyAt === null || timing.workerStartedAt === null
        ? null
        : Math.max(0, Math.round(timing.workerStartedAt - timing.sourceReadyAt)),
      workerMs: timing.workerStartedAt === null
        ? null
        : Math.max(0, Math.round(endedAt - timing.workerStartedAt)),
      totalMs: Math.max(0, Math.round(endedAt - timing.startedAt)),
    },
  })
}

export function logImageEditorViewportCompositeFailedV3(
  timing: ImageEditorViewportCompositeTimingV3,
  error: Error,
): void {
  logger.error('图片编辑 V3 视口分块合成失败', error, {
    event: 'image_editor_v3.viewport_composite.failed',
    requestId: timing.requestId,
    context: {
      documentId: timing.documentId,
      revision: timing.revision,
      phase: timing.phase,
      coverage: timing.coverage,
      totalMs: Math.max(0, Math.round(now() - timing.startedAt)),
    },
  })
}
