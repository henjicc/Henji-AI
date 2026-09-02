import { useEffect, useId, useMemo, useRef, useState } from 'react'

import { createImageEditGeometryHashV3 } from '@/core/imageEdit/v3'
import { createLogger } from '@/core/logging'
import type { ImageEditorV3ResourceDescriptor } from '@/platform/contracts/imageEditorV3'
import type { ImageEditCommandBusSnapshotV3 } from '../application/imageEditCommandBus'
import { projectImageEditorPreviewDocumentV3 } from './previewDocumentV3'
import {
  ImageEditorViewportCompositeClientV3,
  ImageEditorViewportCompositeDisposedErrorV3,
  ImageEditorViewportCompositeSupersededErrorV3,
  type ImageEditorManagedViewportCompositeV3,
} from './viewportCompositeClientV3'
import { ImageEditorViewportCompositeUnsupportedErrorV3 } from './viewportCompositeDocumentV3'
import type { ImageEditorViewportTransformV3 } from './viewportTilePlannerV3'
import { useImageEditorDisposableV3 } from './useImageEditorDisposableV3'
import { useImageEditorResultLeaseV3 } from './useImageEditorResultLeaseV3'

const logger = createLogger('image_editor_v3.viewport_composite_hook')
const EMPTY_RESOURCE_DESCRIPTORS: readonly ImageEditorV3ResourceDescriptor[] = []

export interface ImageEditorViewportCompositeStateV3 {
  result: ImageEditorManagedViewportCompositeV3 | null
  diagnostic: string | null
  fallbackRequired: boolean
  rendering: boolean
  renderGeneration: number
  cameraSequence: number
  geometryHash: string
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
  const document = useMemo(() => projectImageEditorPreviewDocumentV3(snapshot), [snapshot])
  const identityRef = useRef<{
    document: typeof document
    previewOverrides: typeof snapshot.previewOverrides
    renderGeneration: number
    viewportKey: string | null
    cameraSequence: number
  } | null>(null)
  const previousIdentity = identityRef.current
  const renderChanged = !previousIdentity
    || previousIdentity.document !== document
    || previousIdentity.previewOverrides !== snapshot.previewOverrides
  const cameraChanged = !previousIdentity || previousIdentity.viewportKey !== (layout?.viewportKey ?? null)
  const renderGeneration = renderChanged
    ? (previousIdentity?.renderGeneration ?? 0) + 1
    : previousIdentity.renderGeneration
  const cameraSequence = cameraChanged
    ? (previousIdentity?.cameraSequence ?? 0) + 1
    : previousIdentity.cameraSequence
  identityRef.current = {
    document,
    previewOverrides: snapshot.previewOverrides,
    renderGeneration,
    viewportKey: layout?.viewportKey ?? null,
    cameraSequence,
  }
  const geometryHash = createImageEditGeometryHashV3(document.geometry)
  const [state, setState] = useState<ImageEditorViewportCompositeStateV3>({
    result: null,
    diagnostic: null,
    fallbackRequired: false,
    rendering: false,
    renderGeneration,
    cameraSequence,
    geometryHash,
  })

  useImageEditorDisposableV3(client)
  useImageEditorResultLeaseV3(state.result)

  useEffect(() => {
    if (!enabled || !layout || typeof Worker === 'undefined') {
      client.cancel()
      setState((current) => ({
        ...current,
        diagnostic: null,
        fallbackRequired: enabled && typeof Worker === 'undefined',
        rendering: false,
        renderGeneration,
        cameraSequence,
        geometryHash,
      }))
      return
    }
    let acceptsResult = true
    const quality = Object.keys(snapshot.previewOverrides).length > 0 ? 'draft' : 'stable'
    setState((current) => ({
      ...current,
      rendering: true,
      diagnostic: null,
      fallbackRequired: false,
      renderGeneration,
      cameraSequence,
      geometryHash,
    }))
    const animationFrame = requestAnimationFrame(() => {
      if (!acceptsResult) return
      void client.render({
        document,
        renderGeneration,
        cameraSequence,
        geometryHash,
        quality,
        resourceDescriptors,
        viewport: layout.viewport,
        viewportKey: layout.viewportKey,
      }).then((result) => {
        if (!acceptsResult) {
          result.release()
          return
        }
        setState({
          result,
          diagnostic: null,
          fallbackRequired: false,
          rendering: false,
          renderGeneration,
          cameraSequence,
          geometryHash,
        })
      }).catch((error: unknown) => {
        if (!acceptsResult
          || error instanceof ImageEditorViewportCompositeSupersededErrorV3
          || error instanceof ImageEditorViewportCompositeDisposedErrorV3) return
        if (error instanceof ImageEditorViewportCompositeUnsupportedErrorV3) {
          setState((current) => ({
            ...current,
            diagnostic: null,
            fallbackRequired: true,
            rendering: false,
            renderGeneration,
            cameraSequence,
            geometryHash,
          }))
          return
        }
        const message = error instanceof Error ? error.message : String(error)
        logger.warn('视口分块预览失败，继续显示全局受管预览', {
          event: 'image_editor_v3.viewport_composite.fallback',
          context: { documentId: document.id, revision: document.revision, message },
        })
        setState((current) => ({
          ...current,
          diagnostic: message,
          fallbackRequired: true,
          rendering: false,
          renderGeneration,
          cameraSequence,
          geometryHash,
        }))
      })
    })
    return () => {
      acceptsResult = false
      cancelAnimationFrame(animationFrame)
    }
  }, [
    cameraSequence,
    client,
    document,
    enabled,
    geometryHash,
    layout,
    renderGeneration,
    resourceDescriptors,
    snapshot.previewOverrides,
  ])

  return state
}
