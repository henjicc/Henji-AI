import {
  IMAGE_EDIT_SELECTION_MAX_LASSO_POINTS_V3,
  type ImageEditSelectionCombineModeV3,
  type ImageEditSelectionPointV3,
} from '@/core/imageEdit/v3/selection'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'

import type { ImageEditCommandBusV3 } from '../application/imageEditCommandBus'
import { useImageEditorSessionStoreV3 } from '../store'
import { resolveAnnotationOutputGeometryV3 } from './annotationGeometryV3'
import {
  captureEditorPointerV3,
  matchesEditorPointerV3,
  releaseEditorPointerV3,
  type CapturedEditorPointerV3,
} from './pointerCaptureV3'
import {
  imageEditorSelectionOutputToLayerShapeV3,
  isImageEditorSelectionGestureDrawableV3,
  type ImageEditorSelectionToolV3,
} from './selectionMaskGeometryV3'
import { ImageEditorSelectionMaskCommitV3 } from './selectionMaskCommitV3'
import {
  resolveImageEditorSelectionMaskTargetV3,
  type ImageEditorSelectionMaskTargetV3,
} from './selectionMaskLayerV3'
import type { ImageEditorV3Controller } from './types'

const EMPTY_IDS: readonly string[] = []

interface SelectionDraftV3 {
  tool: ImageEditorSelectionToolV3
  start: ImageEditSelectionPointV3
  end: ImageEditSelectionPointV3
  lassoPoints: ImageEditSelectionPointV3[]
}

interface ActiveSelectionGestureV3 {
  pointer: CapturedEditorPointerV3
  documentId: string
  documentRevision: number
  committedRevision?: number
  selectedLayerIdsKey: string
  tool: ImageEditorSelectionToolV3
  combineMode: ImageEditSelectionCombineModeV3
  target: ImageEditorSelectionMaskTargetV3
  draft: SelectionDraftV3
  lastClientPoint: readonly [number, number]
  phase: 'drawing' | 'committing'
  commit?: ImageEditorSelectionMaskCommitV3
}

function isSelectionTool(tool: string): tool is ImageEditorSelectionToolV3 {
  return tool === 'select-rect' || tool === 'select-ellipse' || tool === 'select-lasso'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function SelectionShapeV3({ draft }: { draft: SelectionDraftV3 }): JSX.Element {
  const left = Math.min(draft.start.x, draft.end.x)
  const top = Math.min(draft.start.y, draft.end.y)
  const width = Math.abs(draft.end.x - draft.start.x)
  const height = Math.abs(draft.end.y - draft.start.y)
  const common = {
    className: 'fill-brand-500/10 stroke-brand-300',
    strokeWidth: 1.5,
    strokeDasharray: '6 4',
    vectorEffect: 'non-scaling-stroke' as const,
  }
  if (draft.tool === 'select-rect') {
    return <rect x={left} y={top} width={width} height={height} {...common} />
  }
  if (draft.tool === 'select-ellipse') {
    return (
      <ellipse
        cx={left + width / 2}
        cy={top + height / 2}
        rx={width / 2}
        ry={height / 2}
        {...common}
      />
    )
  }
  return (
    <polygon
      points={draft.lassoPoints.map((point) => `${point.x},${point.y}`).join(' ')}
      {...common}
    />
  )
}

export function ImageEditorSelectionMaskOverlayV3({
  bus,
  controller,
  resourceByteSizes,
}: {
  bus: ImageEditCommandBusV3
  controller: ImageEditorV3Controller
  resourceByteSizes?: Readonly<Record<string, number>>
}): JSX.Element | null {
  const { t } = useTranslation('ui')
  const svgRef = useRef<SVGSVGElement | null>(null)
  const gestureRef = useRef<ActiveSelectionGestureV3 | null>(null)
  const resourceSizesRef = useRef(new Map<string, number>())
  const [draft, setDraft] = useState<SelectionDraftV3 | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const activeTool = useImageEditorSessionStoreV3(
    (state) => state.sessions[controller.sessionId]?.activeTool ?? 'move',
  )
  const selectedLayerIds = useImageEditorSessionStoreV3(
    (state) => state.sessions[controller.sessionId]?.selectedLayerIds ?? EMPTY_IDS,
  )
  const combineMode = useImageEditorSessionStoreV3(
    (state) => state.sessions[controller.sessionId]?.toolSettings.selectionCombineMode ?? 'replace',
  )
  const geometry = useMemo(
    () => resolveAnnotationOutputGeometryV3(controller.document),
    [controller.document],
  )
  const selectionTool = isSelectionTool(activeTool) ? activeTool : null
  const selectedLayerIdsKey = selectedLayerIds.join('\u0000')

  useEffect(() => {
    for (const [resourceId, byteSize] of Object.entries(resourceByteSizes ?? {})) {
      resourceSizesRef.current.set(resourceId, byteSize)
    }
  }, [resourceByteSizes])

  const clientToOutput = useCallback((clientX: number, clientY: number): ImageEditSelectionPointV3 => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 }
    return {
      x: (clientX - rect.left) / rect.width * geometry.width,
      y: (clientY - rect.top) / rect.height * geometry.height,
    }
  }, [geometry.height, geometry.width])

  const cancelGesture = useCallback((): void => {
    const current = gestureRef.current
    if (!current) return
    gestureRef.current = null
    releaseEditorPointerV3(current.pointer)
    current.commit?.cancel()
    setDraft(null)
  }, [])

  useEffect(() => () => cancelGesture(), [cancelGesture])

  useEffect(() => {
    const current = gestureRef.current
    if (!current) {
      if (!selectionTool) setFailure(null)
      return
    }
    const documentChanged = controller.document.id !== current.documentId
      || (
        controller.document.revision !== current.documentRevision
        && controller.document.revision !== current.committedRevision
      )
    if (documentChanged
      || selectionTool !== current.tool
      || selectedLayerIdsKey !== current.selectedLayerIdsKey
      || combineMode !== current.combineMode) cancelGesture()
  }, [
    cancelGesture,
    combineMode,
    controller.document.id,
    controller.document.revision,
    selectedLayerIdsKey,
    selectionTool,
  ])

  const appendPoint = useCallback((
    current: ActiveSelectionGestureV3,
    clientX: number,
    clientY: number,
  ): void => {
    const output = clientToOutput(clientX, clientY)
    current.draft.end = output
    if (current.tool === 'select-lasso'
      && current.draft.lassoPoints.length < IMAGE_EDIT_SELECTION_MAX_LASSO_POINTS_V3
      && Math.hypot(
        clientX - current.lastClientPoint[0],
        clientY - current.lastClientPoint[1],
      ) >= 1.5) {
      current.draft.lassoPoints.push(output)
      current.lastClientPoint = [clientX, clientY]
    }
  }, [clientToOutput])

  const moveGesture = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const current = gestureRef.current
    if (current?.phase !== 'drawing'
      || !matchesEditorPointerV3(current.pointer, event.pointerId)) return
    const samples = event.nativeEvent.getCoalescedEvents?.() ?? [event]
    for (const sample of samples) appendPoint(current, sample.clientX, sample.clientY)
    setDraft({ ...current.draft })
  }

  const finishGesture = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const current = gestureRef.current
    if (current?.phase !== 'drawing'
      || !matchesEditorPointerV3(current.pointer, event.pointerId)) return
    appendPoint(current, event.clientX, event.clientY)
    releaseEditorPointerV3(current.pointer)
    if (!isImageEditorSelectionGestureDrawableV3(current.draft)) {
      gestureRef.current = null
      setDraft(null)
      return
    }
    const shape = imageEditorSelectionOutputToLayerShapeV3({
      ...current.draft,
      inverseMatrix: current.target.inverseMatrix,
    })
    const commit = new ImageEditorSelectionMaskCommitV3({
      bus,
      document: bus.getSnapshot().document,
      layer: current.target.layer,
      shape,
      combineMode: current.combineMode,
      resourceByteSizes: resourceSizesRef.current,
    })
    current.phase = 'committing'
    current.commit = commit
    setDraft({ ...current.draft })
    void commit.commit().then((committed) => {
      if (committed) current.committedRevision = bus.getSnapshot().document.revision
      if (gestureRef.current === current) setFailure(null)
    }).catch((error: unknown) => {
      if (gestureRef.current === current) {
        setFailure(t('imageEditor.v3.selection.failed', { reason: errorMessage(error) }))
      }
    }).finally(() => {
      if (gestureRef.current === current) {
        gestureRef.current = null
        setDraft(null)
      }
    })
    event.preventDefault()
  }

  const startGesture = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (!selectionTool || event.button !== 0 || gestureRef.current) return
    const document = bus.getSnapshot().document
    const resolved = resolveImageEditorSelectionMaskTargetV3({
      document,
      selectedLayerIds,
      combineMode,
      resourceByteSizes: resourceSizesRef.current,
    })
    if (!resolved.ready) {
      setFailure(t(`imageEditor.v3.selection.${resolved.reason}`))
      return
    }
    const start = clientToOutput(event.clientX, event.clientY)
    const next: ActiveSelectionGestureV3 = {
      pointer: captureEditorPointerV3(event.currentTarget, event.pointerId),
      documentId: document.id,
      documentRevision: document.revision,
      selectedLayerIdsKey,
      tool: selectionTool,
      combineMode,
      target: resolved.target,
      draft: {
        tool: selectionTool,
        start,
        end: start,
        lassoPoints: [start],
      },
      lastClientPoint: [event.clientX, event.clientY],
      phase: 'drawing',
    }
    gestureRef.current = next
    setFailure(null)
    setDraft({ ...next.draft })
    event.preventDefault()
  }

  const cancelPointerGesture = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const current = gestureRef.current
    if (!current || !matchesEditorPointerV3(current.pointer, event.pointerId)) return
    cancelGesture()
  }

  const handleLostPointerCapture = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const current = gestureRef.current
    if (current?.phase !== 'drawing'
      || !matchesEditorPointerV3(current.pointer, event.pointerId)) return
    cancelGesture()
  }

  if (!selectionTool && !failure && !draft) return null
  return (
    <>
      {selectionTool || draft ? (
        /* icon-token-allow: 这是按图片像素坐标绘制的选区轮廓，不是界面图标。 */
        <svg
          ref={svgRef}
          data-selection-mask-overlay
          data-selection-committing={gestureRef.current?.phase === 'committing' || undefined}
          aria-label={t('imageEditor.v3.selection.overlay')}
          viewBox={`0 0 ${geometry.width} ${geometry.height}`}
          preserveAspectRatio="none"
          className={`absolute inset-0 h-full w-full touch-none ${selectionTool ? 'pointer-events-auto' : 'pointer-events-none'}`}
          onPointerDown={startGesture}
          onPointerMove={moveGesture}
          onPointerUp={finishGesture}
          onPointerCancel={cancelPointerGesture}
          onLostPointerCapture={handleLostPointerCapture}
        >
          {draft ? <SelectionShapeV3 draft={draft} /> : null}
        </svg>
      ) : null}
      {failure ? (
        <div
          role="alert"
          className="ui-glass pointer-events-none absolute left-1/2 top-3 max-w-[min(34rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-lg px-3 py-2 text-xs text-text-dark"
        >
          {failure}
        </div>
      ) : null}
    </>
  )
}
