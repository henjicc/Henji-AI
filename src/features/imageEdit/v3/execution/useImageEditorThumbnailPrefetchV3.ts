import { useEffect, useId, useMemo } from 'react'

import { createLogger } from '@/core/logging'
import type { ImageEditorV3ResourceDescriptor } from '@/platform/contracts/imageEditorV3'
import type { ImageEditCommandBusSnapshotV3 } from '../application/imageEditCommandBus'
import type { ImageEditorV3PackageThumbnailSnapshot } from '../editor/types'
import {
  ImageEditorViewportCompositeClientV3,
  ImageEditorViewportCompositeDisposedErrorV3,
  ImageEditorViewportCompositeSupersededErrorV3,
} from './viewportCompositeClientV3'
import { renderImageEditorThumbnailV3 } from './viewportThumbnailV3'
import { ImageEditorPreviewClientV3 } from './imageEditorPreviewClientV3'
import { IMAGE_EDIT_RENDER_PRIORITY } from '@/core/imageEdit/v3/renderScheduler'
import { projectImageEditorPreviewDocumentV3 } from './previewDocumentV3'
import { useImageEditorDisposableV3 } from './useImageEditorDisposableV3'

const logger = createLogger('image_editor_v3.thumbnail')

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
  const client = useMemo(() => new ImageEditorViewportCompositeClientV3({
    sessionId,
    resourceBudgetConsumerId: `thumbnail-prefetch:${resourceBudgetConsumerId}`,
    purpose: 'thumbnail',
  }), [resourceBudgetConsumerId, sessionId])

  useImageEditorDisposableV3(client)

  useEffect(() => {
    if (!enabled || !onThumbnail || typeof Worker === 'undefined') return
    if (Object.keys(snapshot.previewOverrides).length > 0) return
    let active = true
    const controller = new AbortController()
    const cancelIdle = scheduleThumbnailPrefetchV3(() => {
      if (!active) return
      const document = projectImageEditorPreviewDocumentV3(snapshot)
      void renderImageEditorThumbnailV3(client, () => new ImageEditorPreviewClientV3({
        sessionId, resourceBudgetConsumerId: `thumbnail-plain:${resourceBudgetConsumerId}`,
        coalescingKey: 'thumbnail', taskKind: 'prefetch', purpose: 'thumbnail',
        priority: IMAGE_EDIT_RENDER_PRIORITY.prefetch, pyramidPrewarmEnabled: false,
      }), document, resourceDescriptors, controller.signal, sessionId).then((thumbnail) => {
        if (active) onThumbnail(thumbnail)
      }).catch((error: unknown) => {
        if (!active
          || error instanceof ImageEditorViewportCompositeSupersededErrorV3
          || error instanceof ImageEditorViewportCompositeDisposedErrorV3) return
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
      controller.abort()
      client.cancel()
    }
  }, [client, enabled, onThumbnail, resourceDescriptors, snapshot, sessionId, resourceBudgetConsumerId])
}
