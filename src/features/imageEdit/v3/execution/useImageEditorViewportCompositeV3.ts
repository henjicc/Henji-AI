import { useEffect, useId, useMemo, useRef, useState } from 'react'

import { createImageEditGeometryHashV3 } from '@/core/imageEdit/v3'
import type { ImageEditorV3ResourceDescriptor } from '@/platform/contracts/imageEditorV3'
import type { ImageEditCommandBusSnapshotV3 } from '../application/imageEditCommandBus'
import { projectImageEditorPreviewDocumentV3 } from './previewDocumentV3'
import {
  DefaultImageEditorRenderSessionV3,
  type ImageEditorRenderSessionStateV3,
} from './imageEditorRenderSessionV3'
import type { ImageEditorViewportTransformV3 } from './viewportTilePlannerV3'
import { useImageEditorDisposableV3 } from './useImageEditorDisposableV3'

const EMPTY_RESOURCE_DESCRIPTORS: readonly ImageEditorV3ResourceDescriptor[] = []

export interface ImageEditorViewportCompositeStateV3 extends ImageEditorRenderSessionStateV3 {
  session: DefaultImageEditorRenderSessionV3
}

const EMPTY_STATE: ImageEditorRenderSessionStateV3 = {
  result: null,
  surfaceId: null,
  renderGeneration: 0,
  geometryHash: '',
  cameraSequence: 0,
  coverage: 0,
  targetMipCoverage: 0,
  targetMip: null,
  eventToPresentMs: null,
  rendering: false,
  compositionBackend: 'cpu',
  effectBackend: 'cpu',
  presentationBackend: 'canvas2d',
  deviceStatus: 'idle',
  deviceGeneration: 0,
  fallbackRequired: false,
  diagnostic: null,
}

export function useImageEditorViewportCompositeV3(
  sessionId: string,
  snapshot: ImageEditCommandBusSnapshotV3,
  enabled: boolean,
  resourceDescriptors: readonly ImageEditorV3ResourceDescriptor[] = EMPTY_RESOURCE_DESCRIPTORS,
  layout: {
    viewport: ImageEditorViewportTransformV3
    viewportKey: string
    stageWidth: number
    stageHeight: number
  } | null,
): ImageEditorViewportCompositeStateV3 {
  const resourceBudgetConsumerId = useId()
  const session = useMemo(() => new DefaultImageEditorRenderSessionV3({
    sessionId,
    resourceBudgetConsumerId: `render-session:${resourceBudgetConsumerId}`,
  }), [resourceBudgetConsumerId, sessionId])
  const document = useMemo(() => projectImageEditorPreviewDocumentV3(snapshot), [snapshot])
  const identityRef = useRef<{
    document: typeof document
    previewOverrides: typeof snapshot.previewOverrides
    resourceDescriptors: typeof resourceDescriptors
    renderGeneration: number
  } | null>(null)
  const previousIdentity = identityRef.current
  const renderChanged = !previousIdentity
    || previousIdentity.document !== document
    || previousIdentity.previewOverrides !== snapshot.previewOverrides
    || previousIdentity.resourceDescriptors !== resourceDescriptors
  const renderGeneration = renderChanged
    ? (previousIdentity?.renderGeneration ?? 0) + 1
    : previousIdentity.renderGeneration
  identityRef.current = {
    document,
    previewOverrides: snapshot.previewOverrides,
    resourceDescriptors,
    renderGeneration,
  }
  const geometryHash = createImageEditGeometryHashV3(document.geometry)
  const [state, setState] = useState<ImageEditorRenderSessionStateV3>(EMPTY_STATE)

  useImageEditorDisposableV3(session)

  useEffect(() => session.subscribeState(setState), [session])

  useEffect(() => {
    if (!enabled || !layout) return
    session.updateViewport(layout)
  }, [enabled, layout, session])

  useEffect(() => {
    session.setVisibility(enabled && typeof Worker !== 'undefined')
    if (!enabled || typeof Worker === 'undefined') return
    session.updateSnapshot({
      document,
      renderGeneration,
      geometryHash,
      quality: Object.keys(snapshot.previewOverrides).length > 0 ? 'draft' : 'stable',
      resourceDescriptors,
      eventTimestamp: typeof performance === 'undefined' ? Date.now() : performance.now(),
    })
  }, [
    document,
    enabled,
    geometryHash,
    renderGeneration,
    resourceDescriptors,
    session,
    snapshot.previewOverrides,
  ])

  return {
    ...state,
    fallbackRequired: state.fallbackRequired || (enabled && typeof Worker === 'undefined'),
    renderGeneration,
    geometryHash,
    session,
  }
}
