import { useEffect, useMemo } from 'react'
import { Canvas, useThree } from '@react-three/fiber'

import type {
  MultiAngleDiscretePreset,
  MultiAngleViewV1,
} from '@/features/canvas/capabilities/multiAnglePolicy'
import {
  createMultiAngleEditorResources,
  disposeMultiAngleEditorResources,
} from './multiAngleEditorResources'

function markerPosition(view: MultiAngleViewV1): [number, number, number] {
  if (view.kind === 'continuous') {
    const yaw = (view.yawControlDeg / 180) * Math.PI
    const radius = 1.55 - view.proximity * 0.045
    return [
      Math.sin(yaw) * radius,
      -view.verticalControl * 0.95,
      Math.cos(yaw) * radius,
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
}: {
  views: MultiAngleViewV1[]
  selectedViewId: string
}): JSX.Element {
  return (
    <div className="pointer-events-none absolute inset-0" data-multi-angle-orbit="demand">
      <Canvas
        frameloop="demand"
        dpr={[1, 1.5]}
        camera={{ fov: 48, near: 0.1, far: 20, position: [3.8, 2.5, 4.5] }}
        gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
      >
        <OrbitScene views={views} selectedViewId={selectedViewId} />
      </Canvas>
    </div>
  )
}
