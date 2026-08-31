import { useEffect, useId, useMemo, useState } from 'react'

import { createLogger } from '@/core/logging'
import type { ImageEditorV3ResourceDescriptor } from '@/platform/contracts/imageEditorV3'
import type { ImageEditCommandBusSnapshotV3 } from '../application/imageEditCommandBus'
import { projectImageEditorPreviewDocumentV3 } from './previewDocumentV3'
import {
  ImageEditorViewportCompositeClientV3,
  ImageEditorViewportCompositeSupersededErrorV3,
  type ImageEditorManagedViewportCompositeV3,
} from './viewportCompositeClientV3'
import { ImageEditorViewportCompositeUnsupportedErrorV3 } from './viewportCompositeDocumentV3'
import type { ImageEditorViewportTransformV3 } from './viewportTilePlannerV3'
import { useImageEditorDisposableV3 } from './useImageEditorDisposableV3'

const logger = createLogger('image_editor_v3.viewport_composite_hook')
const EMPTY_RESOURCE_DESCRIPTORS: readonly ImageEditorV3ResourceDescriptor[] = []

export interface ImageEditorViewportCompositeStateV3 {
  result: ImageEditorManagedViewportCompositeV3 | null
  diagnostic: string | null
  rendering: boolean
}

export function useImageEditorViewportCompositeV3(
  sessionId: string,
  snapshot: ImageEditCommandBusSnapshotV3,
  enabled: boolean,
  resourceDescriptors: readonly ImageEditorV3ResourceDescriptor[] = EMPTY_RESOURCE_DESCRIPTORS,
  layout: { viewport: ImageEditorViewportTransformV3; viewportKey: string } | null,
): ImageEditorViewportCompositeStateV3 {
  const resourceBudgetConsumerId = useId()
  const client = useMemo(() => new ImageEditorViewportCompositeClientV3({
    sessionId,
    resourceBudgetConsumerId: `viewport-composite:${resourceBudgetConsumerId}`,
  }), [resourceBudgetConsumerId, sessionId])
  const [state, setState] = useState<ImageEditorViewportCompositeStateV3>({
    result: null,
    diagnostic: null,
    rendering: false,
  })

  useImageEditorDisposableV3(client)

  useEffect(() => {
    if (!enabled || !layout || typeof Worker === 'undefined') {
      client.cancel()
      setState((current) => {
        current.result?.release()
        return { result: null, diagnostic: null, rendering: false }
      })
      return
    }
    let acceptsResult = true
    const document = projectImageEditorPreviewDocumentV3(snapshot)
    const quality = Object.keys(snapshot.previewOverrides).length > 0 ? 'draft' : 'stable'
    setState((current) => {
      current.result?.release()
      return { result: null, rendering: true, diagnostic: null }
    })
    queueMicrotask(() => {
      if (!acceptsResult) return
      void client.render({
        document,
        quality,
        resourceDescriptors,
        viewport: layout.viewport,
        viewportKey: layout.viewportKey,
      }).then((result) => {
        if (!acceptsResult) {
          result.release()
          return
        }
        setState((current) => {
          if (current.result !== result) current.result?.release()
          return { result, diagnostic: null, rendering: false }
        })
      }).catch((error: unknown) => {
        if (!acceptsResult || error instanceof ImageEditorViewportCompositeSupersededErrorV3) return
        if (error instanceof ImageEditorViewportCompositeUnsupportedErrorV3) {
          setState((current) => {
            current.result?.release()
            return { result: null, diagnostic: null, rendering: false }
          })
          return
        }
        const message = error instanceof Error ? error.message : String(error)
        logger.warn('视口分块预览失败，继续显示全局受管预览', {
          event: 'image_editor_v3.viewport_composite.fallback',
          context: { documentId: document.id, revision: document.revision, message },
        })
        setState((current) => {
          current.result?.release()
          return { result: null, diagnostic: message, rendering: false }
        })
      })
    })
    return () => { acceptsResult = false }
  }, [client, enabled, layout, resourceDescriptors, snapshot])

  return state
}
