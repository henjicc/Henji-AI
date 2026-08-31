import { useEffect, useId, useMemo } from 'react'

import { createLogger } from '@/core/logging'
import { IMAGE_EDIT_RENDER_PRIORITY } from '@/core/imageEdit/v3/renderScheduler'
import type { ImageEditorV3ResourceDescriptor } from '@/platform/contracts/imageEditorV3'
import type { ImageEditCommandBusSnapshotV3 } from '../application/imageEditCommandBus'
import type { ImageEditorV3PackageThumbnailSnapshot } from '../editor/types'
import {
  ImageEditorPreviewClientV3,
  ImageEditorPreviewDisposedErrorV3,
  ImageEditorPreviewSupersededErrorV3,
} from './imageEditorPreviewClientV3'
import { projectImageEditorPreviewDocumentV3 } from './previewDocumentV3'
import { useImageEditorDisposableV3 } from './useImageEditorDisposableV3'

const logger = createLogger('image_editor_v3.thumbnail')
const THUMBNAIL_MAX_EDGE_V3 = 512

interface IdleCapableWindowV3 {
  requestIdleCallback?: (callback: () => void) => number
  cancelIdleCallback?: (handle: number) => void
}

function scheduleThumbnailPrefetchV3(run: () => void): () => void {
  const host = window as unknown as IdleCapableWindowV3
  if (typeof host.requestIdleCallback === 'function') {
    const handle = host.requestIdleCallback(run)
    return () => host.cancelIdleCallback?.(handle)
  }
  const handle = window.setTimeout(run, 250)
  return () => window.clearTimeout(handle)
}

/**
 * 缩略图是独立的空闲预取流：它永远不作为显示结果，也不会取代 display 流。
 */
export function useImageEditorThumbnailPrefetchV3(
  sessionId: string,
  snapshot: ImageEditCommandBusSnapshotV3,
  enabled: boolean,
  resourceDescriptors: readonly ImageEditorV3ResourceDescriptor[],
  onThumbnail: ((thumbnail: ImageEditorV3PackageThumbnailSnapshot) => void) | undefined,
): void {
  const resourceBudgetConsumerId = useId()
  const client = useMemo(() => new ImageEditorPreviewClientV3({
    sessionId,
    resourceBudgetConsumerId: `thumbnail-prefetch:${resourceBudgetConsumerId}`,
    coalescingKey: 'thumbnail',
    taskKind: 'prefetch',
    purpose: 'thumbnail',
    priority: IMAGE_EDIT_RENDER_PRIORITY.prefetch,
    pyramidPrewarmEnabled: false,
  }), [resourceBudgetConsumerId, sessionId])

  useImageEditorDisposableV3(client)

  useEffect(() => {
    if (!enabled || !onThumbnail || typeof Worker === 'undefined') return
    if (Object.keys(snapshot.previewOverrides).length > 0) return
    let active = true
    const cancelIdle = scheduleThumbnailPrefetchV3(() => {
      if (!active) return
      const document = projectImageEditorPreviewDocumentV3(snapshot)
      void client.render({
        document,
        quality: 'stable',
        maxDimension: THUMBNAIL_MAX_EDGE_V3,
        resourceDescriptors,
      }).then((result) => {
        try {
          if (!active || !result.thumbnail) return
          onThumbnail({
            documentId: snapshot.document.id,
            revision: snapshot.document.revision,
            bytes: result.thumbnail.bytes.slice(0),
            mediaType: result.thumbnail.mediaType,
            extension: result.thumbnail.mediaType === 'image/webp' ? 'webp' : 'png',
          })
        } finally {
          result.release()
        }
      }).catch((error: unknown) => {
        if (!active
          || error instanceof ImageEditorPreviewSupersededErrorV3
          || error instanceof ImageEditorPreviewDisposedErrorV3) return
        logger.warn('图片编辑 V3 缩略图空闲预取失败', {
          event: 'image_editor_v3.thumbnail.failed',
          context: {
            documentId: snapshot.document.id,
            revision: snapshot.document.revision,
            purpose: 'thumbnail',
            message: error instanceof Error ? error.message : String(error),
          },
        })
      })
    })
    return () => {
      active = false
      cancelIdle()
    }
  }, [client, enabled, onThumbnail, resourceDescriptors, snapshot])
}
