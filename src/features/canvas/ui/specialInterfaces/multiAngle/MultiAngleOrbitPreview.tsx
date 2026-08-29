import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from 'react'
import { Canvas, useThree } from '@react-three/fiber'

import { UI_FIELD_FOCUS_CLASS } from '@/components/ui/styleTokens'
import type {
  MultiAngleContinuousViewV1,
  MultiAngleDiscretePreset,
  MultiAngleFluxViewV1,
  MultiAngleViewV1,
} from '@/features/canvas/capabilities/multiAnglePolicy'
import {
  createMultiAngleEditorResources,
  disposeMultiAngleEditorResources,
} from './multiAngleEditorResources'
import {
  continuousCameraFromDrag,
  continuousCameraFromKey,
  describeMultiAngleCamera,
  discretePresetFromPoint,
  fluxCameraFromDrag,
  fluxCameraFromKey,
  fluxZoomFromWheel,
  proximityFromWheel,
  type MultiAngleCameraDragOrigin,
  type MultiAngleFluxCameraDragOrigin,
} from './multiAngleCameraVisualizerState'

function markerPosition(view: MultiAngleViewV1): [number, number, number] {
  if (view.kind === 'continuous') {
    const yaw = (view.yawControlDeg / 180) * Math.PI
    const radius = 1.62 - view.proximity * 0.052
    return [
      -Math.sin(yaw) * radius,
      -view.verticalControl * 0.95,
      Math.cos(yaw) * radius,
    ]
  }
  if (view.kind === 'flux') {
    const horizontal = (view.horizontalAngleDeg / 180) * Math.PI
    const vertical = (view.verticalAngleDeg / 180) * Math.PI
    const radius = 1.62 - view.zoom * 0.052
    return [
      Math.sin(horizontal) * Math.cos(vertical) * radius,
      Math.sin(vertical) * radius,
      Math.cos(horizontal) * Math.cos(vertical) * radius,
    ]
  }
  const positions: Record<MultiAngleDiscretePreset, [number, number, number]> = {
    front: [0, 0, 1.55],
    left_side: [-1.55, 0, 0],
    right_side: [1.55, 0, 0],
    back: [0, 0, -1.55],
    top_down: [0, 1.4, 0],
    bottom_up: [0, -1.4, 0],
    birds_eye: [-0.5, 1.25, 0.85],
    three_quarter_left: [-1.08, 0, 1.08],
    three_quarter_right: [1.08, 0, 1.08],
  }
  return positions[view.preset]
}

function OrbitScene({ views, selectedViewId }: { views: MultiAngleViewV1[]; selectedViewId: string }): JSX.Element {
  const resources = useMemo(createMultiAngleEditorResources, [])
  const { invalidate } = useThree()

  useEffect(() => () => disposeMultiAngleEditorResources(resources), [resources])
  useEffect(() => { invalidate() }, [invalidate, selectedViewId, views])

  return (
    <>
      <mesh geometry={resources.horizontalOrbit} material={resources.orbitMaterial} rotation={[Math.PI / 2, 0, 0]} dispose={null} />
      <mesh geometry={resources.verticalOrbit} material={resources.orbitMaterial} rotation={[0, Math.PI / 2, 0]} dispose={null} />
      {views.map((view) => (
        <mesh
          key={view.viewId}
          geometry={resources.marker}
          material={view.viewId === selectedViewId ? resources.markerMaterial : resources.orbitMaterial}
          position={markerPosition(view)}
          scale={view.viewId === selectedViewId ? 1.35 : 0.85}
          dispose={null}
        />
      ))}
    </>
  )
}

export function MultiAngleOrbitPreview({
  views,
  selectedViewId,
  onContinuousChange,
  onDiscretePresetChange,
  onFluxChange,
}: {
  views: MultiAngleViewV1[]
  selectedViewId: string
  onContinuousChange: (patch: Partial<MultiAngleContinuousViewV1>) => void
  onDiscretePresetChange: (preset: MultiAngleDiscretePreset) => void
  onFluxChange: (patch: Partial<MultiAngleFluxViewV1>) => void
}): JSX.Element {
  const selected = views.find((view) => view.viewId === selectedViewId) ?? views[0]
  const [dragging, setDragging] = useState(false)
  const [transientView, setTransientView] = useState<MultiAngleContinuousViewV1 | MultiAngleFluxViewV1 | null>(null)
  const activePointerId = useRef<number | null>(null)
  const continuousDragOrigin = useRef<MultiAngleCameraDragOrigin | null>(null)
  const fluxDragOrigin = useRef<MultiAngleFluxCameraDragOrigin | null>(null)
  const transientViewRef = useRef<MultiAngleContinuousViewV1 | MultiAngleFluxViewV1 | null>(null)
  const lastEmitted = useRef('')
  const visualSelected = transientView?.viewId === selected?.viewId ? transientView : selected
  const visualViews = useMemo(() => transientView
    ? views.map((view) => view.viewId === transientView.viewId ? transientView : view)
    : views, [transientView, views])

  useEffect(() => {
    if (selected?.kind === 'continuous') {
      lastEmitted.current = `${selected.yawControlDeg}/${selected.verticalControl}/${selected.proximity}`
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
    const signature = `${next.yawControlDeg}/${next.verticalControl}/${next.proximity}`
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
    const bounds = event.currentTarget.getBoundingClientRect()
    const preset = discretePresetFromPoint(event.clientX, event.clientY, bounds)
    if (preset === lastEmitted.current) return
    lastEmitted.current = preset
    onDiscretePresetChange(preset)
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || !selected) return
    event.preventDefault()
    activePointerId.current = event.pointerId
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
    if (selected.kind === 'continuous') {
      continuousDragOrigin.current = {
        clientX: event.clientX,
        clientY: event.clientY,
        yawControlDeg: selected.yawControlDeg,
        verticalControl: selected.verticalControl,
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
    emitDiscrete(event)
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (activePointerId.current !== event.pointerId || !selected) return
    if (selected.kind === 'discrete') {
      emitDiscrete(event)
      return
    }
    const bounds = event.currentTarget.getBoundingClientRect()
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
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    activePointerId.current = null
    continuousDragOrigin.current = null
    fluxDragOrigin.current = null
    setDragging(false)
    const committed = transientViewRef.current
    transientViewRef.current = null
    if (committed?.kind === 'continuous') {
      emitContinuous({
        yawControlDeg: committed.yawControlDeg,
        verticalControl: committed.verticalControl,
      })
    } else if (committed?.kind === 'flux') {
      emitFlux({
        horizontalAngleDeg: committed.horizontalAngleDeg,
        verticalAngleDeg: committed.verticalAngleDeg,
      })
    }
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
    if (!selected || selected.kind === 'discrete') return
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
      aria-label="镜头方位控制"
      aria-roledescription="可拖拽镜头轨道"
      aria-valuetext={visualSelected ? describeMultiAngleCamera(visualSelected) : '未选择视图'}
      data-multi-angle-orbit="demand"
      data-multi-angle-camera-control="true"
      data-multi-angle-profile={visualSelected?.kind ?? 'none'}
      data-multi-angle-yaw={visualSelected?.kind === 'continuous' ? visualSelected.yawControlDeg : undefined}
      data-multi-angle-horizontal={visualSelected?.kind === 'flux' ? visualSelected.horizontalAngleDeg : undefined}
      data-multi-angle-vertical={visualSelected?.kind === 'continuous'
        ? visualSelected.verticalControl
        : visualSelected?.kind === 'flux'
          ? visualSelected.verticalAngleDeg
          : undefined}
      data-multi-angle-proximity={visualSelected?.kind === 'continuous' ? visualSelected.proximity : undefined}
      data-multi-angle-zoom={visualSelected?.kind === 'flux' ? visualSelected.zoom : undefined}
      className={`absolute inset-0 touch-none select-none overflow-hidden rounded-xl ${UI_FIELD_FOCUS_CLASS} ${dragging ? 'cursor-grabbing ring-1 ring-accent/50' : 'cursor-grab'}`}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointer}
      onPointerCancel={finishPointer}
      onWheel={handleWheel}
    >
      <Canvas
        className="pointer-events-none"
        frameloop="demand"
        dpr={[1, 1.5]}
        camera={{ fov: 48, near: 0.1, far: 20, position: [3.8, 2.5, 4.5] }}
        gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
      >
        <OrbitScene views={visualViews} selectedViewId={selectedViewId} />
      </Canvas>

      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-3xs font-medium uppercase tracking-wide text-text-muted">左</span>
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-3xs font-medium uppercase tracking-wide text-text-muted">右</span>
      <span className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 text-3xs font-medium tracking-wide text-text-muted">高位</span>
      {visualSelected?.kind !== 'flux' && (
        <span className="pointer-events-none absolute bottom-12 left-1/2 -translate-x-1/2 text-3xs font-medium tracking-wide text-text-muted">低位</span>
      )}
    </div>
  )
}
