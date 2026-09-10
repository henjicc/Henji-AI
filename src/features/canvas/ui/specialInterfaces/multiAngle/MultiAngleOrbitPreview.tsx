import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from 'react'
import { useTranslation } from 'react-i18next'

import { UI_FIELD_FOCUS_CLASS } from '@/components/ui/styleTokens'
import {
  MULTI_ANGLE_DISCRETE_VIEW_PRESETS,
  type MultiAngleContinuousViewV1,
  type MultiAngleDiscretePreset,
  type MultiAngleFluxViewV1,
  type MultiAngleViewV1,
} from '@/features/canvas/capabilities/multiAnglePolicy'
import { MultiAngleOrbitScene } from './MultiAngleOrbitScene'
import { multiAngleOrientation, type MultiAngleOrientation } from './multiAngleOrbitGeometry'
import {
  continuousCameraFromDrag,
  continuousCameraFromKey,
  discreteOrientationFromDrag,
  discretePresetForOrientation,
  fluxCameraFromDrag,
  fluxCameraFromKey,
  fluxZoomFromWheel,
  proximityFromWheel,
  snapContinuousCamera,
  snapFluxCamera,
  type MultiAngleStageMetrics,
  type MultiAngleCameraDragOrigin,
  type MultiAngleFluxCameraDragOrigin,
} from './multiAngleCameraVisualizerState'
import { describeLocalizedMultiAngleCamera } from './multiAngleLocalization'

export function MultiAngleOrbitPreview({
  views,
  selectedViewId,
  onContinuousChange,
  onDiscretePresetChange,
  onFluxChange,
  sourceImage,
  sourceAlt,
}: {
  views: MultiAngleViewV1[]
  selectedViewId: string
  onContinuousChange: (patch: Partial<MultiAngleContinuousViewV1>) => void
  onDiscretePresetChange: (preset: MultiAngleDiscretePreset) => void
  onFluxChange: (patch: Partial<MultiAngleFluxViewV1>) => void
  sourceImage?: string | null
  sourceAlt?: string
}): JSX.Element {
  const { t } = useTranslation()
  const selected = views.find((view) => view.viewId === selectedViewId) ?? views[0]
  const [dragging, setDragging] = useState(false)
  const [transientView, setTransientView] = useState<MultiAngleViewV1 | null>(null)
  const [previewOrientation, setPreviewOrientation] = useState<MultiAngleOrientation | null>(null)
  const dragStage = useRef<{ metrics: MultiAngleStageMetrics; origin: MultiAngleOrientation & { clientX: number; clientY: number } } | null>(null)
  const activePointerId = useRef<number | null>(null)
  const continuousDragOrigin = useRef<MultiAngleCameraDragOrigin | null>(null)
  const fluxDragOrigin = useRef<MultiAngleFluxCameraDragOrigin | null>(null)
  const transientViewRef = useRef<MultiAngleViewV1 | null>(null)
  const lastEmitted = useRef('')
  const visualSelected = transientView?.viewId === selected?.viewId ? transientView : selected
  const visualViews = useMemo(() => transientView
    ? views.map((view) => view.viewId === transientView.viewId ? transientView : view)
    : views, [transientView, views])

  useEffect(() => {
    if (selected?.kind === 'continuous') {
      lastEmitted.current = `${selected.yawControlDeg}/${selected.elevationDeg}/${selected.proximity}`
    } else if (selected?.kind === 'flux') {
      lastEmitted.current = `${selected.horizontalAngleDeg}/${selected.verticalAngleDeg}/${selected.zoom}`
    } else {
      lastEmitted.current = selected?.preset ?? ''
    }
  }, [selected])

  useEffect(() => {
    if (dragging) return
    transientViewRef.current = null
    setTransientView(null)
  }, [dragging, selected])

  const emitContinuous = (patch: Partial<MultiAngleContinuousViewV1>): void => {
    if (!selected || selected.kind !== 'continuous') return
    const next = { ...selected, ...patch }
    const signature = `${next.yawControlDeg}/${next.elevationDeg}/${next.proximity}`
    if (signature === lastEmitted.current) return
    lastEmitted.current = signature
    onContinuousChange(patch)
  }

  const emitFlux = (patch: Partial<MultiAngleFluxViewV1>): void => {
    if (!selected || selected.kind !== 'flux') return
    const next = { ...selected, ...patch }
    const signature = `${next.horizontalAngleDeg}/${next.verticalAngleDeg}/${next.zoom}`
    if (signature === lastEmitted.current) return
    lastEmitted.current = signature
    onFluxChange(patch)
  }

  const emitDiscrete = (event: PointerEvent<HTMLDivElement>): void => {
    if (!selected || selected.kind !== 'discrete') return
    const stage = dragStage.current
    if (!stage) return
    const pose = discreteOrientationFromDrag(stage.origin, event.clientX, event.clientY, stage.metrics)
    setPreviewOrientation(pose)
    const preset = discretePresetForOrientation(pose)
    if (transientViewRef.current?.kind === 'discrete' && transientViewRef.current.preset === preset) return
    const definition = MULTI_ANGLE_DISCRETE_VIEW_PRESETS.find(item => item.view.preset === preset)
    if (!definition) return
    const next = { ...definition.view, viewId: selected.viewId }
    transientViewRef.current = next
    setTransientView(next)
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || !selected || activePointerId.current !== null) return
    event.preventDefault()
    event.stopPropagation()
    activePointerId.current = event.pointerId
    dragStage.current = { metrics: event.currentTarget.getBoundingClientRect(),
      origin: { ...multiAngleOrientation(selected), clientX: event.clientX, clientY: event.clientY } }
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
    if (selected.kind === 'continuous') {
      continuousDragOrigin.current = {
        clientX: event.clientX,
        clientY: event.clientY,
        yawControlDeg: selected.yawControlDeg,
        elevationDeg: selected.elevationDeg,
      }
      return
    }
    if (selected.kind === 'flux') {
      fluxDragOrigin.current = {
        clientX: event.clientX,
        clientY: event.clientY,
        horizontalAngleDeg: selected.horizontalAngleDeg,
        verticalAngleDeg: selected.verticalAngleDeg,
      }
      return
    }
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (activePointerId.current !== event.pointerId || !selected) return
    if (selected.kind === 'discrete') {
      emitDiscrete(event)
      return
    }
    const bounds = dragStage.current?.metrics
    if (!bounds) return
    if (selected.kind === 'continuous' && continuousDragOrigin.current) {
      const next = {
        ...selected,
        ...continuousCameraFromDrag(
          continuousDragOrigin.current,
          event.clientX,
          event.clientY,
          bounds,
        ),
      }
      transientViewRef.current = next
      setTransientView(next)
      return
    }
    if (selected.kind === 'flux' && fluxDragOrigin.current) {
      const next = {
        ...selected,
        ...fluxCameraFromDrag(fluxDragOrigin.current, event.clientX, event.clientY, bounds),
      }
      transientViewRef.current = next
      setTransientView(next)
    }
  }

  const finishPointer = (event: PointerEvent<HTMLDivElement>): void => {
    if (activePointerId.current !== event.pointerId) return
    activePointerId.current = null
    continuousDragOrigin.current = null
    fluxDragOrigin.current = null
    dragStage.current = null
    setPreviewOrientation(null)
    setDragging(false)
    const committed = transientViewRef.current
    transientViewRef.current = null
    if (committed?.kind === 'discrete' && committed.preset !== lastEmitted.current) {
      lastEmitted.current = committed.preset
      onDiscretePresetChange(committed.preset)
    } else if (committed?.kind === 'continuous') {
      emitContinuous(snapContinuousCamera(committed))
    } else if (committed?.kind === 'flux') {
      emitFlux(snapFluxCamera(committed))
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const cancelPointer = (): void => {
    activePointerId.current = null
    continuousDragOrigin.current = null
    fluxDragOrigin.current = null
    transientViewRef.current = null
    dragStage.current = null
    setPreviewOrientation(null)
    setTransientView(null)
    setDragging(false)
  }

  const handleWheel = (event: WheelEvent<HTMLDivElement>): void => {
    if (!selected || selected.kind === 'discrete') return
    event.preventDefault()
    if (selected.kind === 'continuous') {
      emitContinuous({ proximity: proximityFromWheel(selected.proximity, event.deltaY) })
    } else {
      emitFlux({ zoom: fluxZoomFromWheel(selected.zoom, event.deltaY) })
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') { event.preventDefault(); cancelPointer(); return }
    if (!selected) return
    if (selected.kind === 'discrete') {
      if (!['Home', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
      event.preventDefault(); event.stopPropagation()
      const index = MULTI_ANGLE_DISCRETE_VIEW_PRESETS.findIndex(item => item.view.preset === selected.preset)
      const delta = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1
      const count = MULTI_ANGLE_DISCRETE_VIEW_PRESETS.length
      onDiscretePresetChange(MULTI_ANGLE_DISCRETE_VIEW_PRESETS[event.key === 'Home' ? 0 : (index + delta + count) % count].view.preset)
      return
    }
    if (selected.kind === 'continuous') {
      const patch = continuousCameraFromKey(selected, event.key)
      if (!patch) return
      event.preventDefault()
      emitContinuous(patch)
      return
    }
    const patch = fluxCameraFromKey(selected, event.key)
    if (!patch) return
    event.preventDefault()
    emitFlux(patch)
  }

  return (
    <div
      role="application"
      tabIndex={0}
      aria-label={t('node.multiAngleEditor.orbit.ariaLabel')}
      aria-roledescription={t('node.multiAngleEditor.orbit.roleDescription')}
      aria-valuetext={visualSelected
        ? describeLocalizedMultiAngleCamera(
            t,
            visualSelected,
            Math.max(views.findIndex((view) => view.viewId === visualSelected.viewId), 0),
          )
        : t('node.multiAngleEditor.noSelection')}
      data-multi-angle-orbit="image-block"
      data-multi-angle-camera-control="true"
      data-multi-angle-profile={visualSelected?.kind ?? 'none'}
      data-multi-angle-yaw={visualSelected?.kind === 'continuous' ? visualSelected.yawControlDeg : undefined}
      data-multi-angle-horizontal={visualSelected?.kind === 'flux' ? visualSelected.horizontalAngleDeg : undefined}
      data-multi-angle-vertical={visualSelected?.kind === 'continuous'
        ? visualSelected.elevationDeg
        : visualSelected?.kind === 'flux'
          ? visualSelected.verticalAngleDeg
          : undefined}
      data-multi-angle-proximity={visualSelected?.kind === 'continuous' ? visualSelected.proximity : undefined}
      data-multi-angle-zoom={visualSelected?.kind === 'flux' ? visualSelected.zoom : undefined}
      className={`absolute inset-0 touch-none select-none overflow-hidden rounded-xl ${dragging ? '' : UI_FIELD_FOCUS_CLASS} ${dragging ? 'cursor-grabbing ring-1 ring-accent/50' : 'cursor-grab'}`}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointer}
      onPointerCancel={cancelPointer}
      onLostPointerCapture={cancelPointer}
      onWheel={handleWheel}
    >
      <MultiAngleOrbitScene views={visualViews} selectedViewId={selectedViewId} sourceImage={sourceImage} sourceAlt={sourceAlt}
        previewOrientation={previewOrientation} onDiscretePresetChange={onDiscretePresetChange} />
    </div>
  )
}
