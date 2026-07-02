import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import type { Object3D } from 'three'
import { TransformControls as TransformControlsImpl } from 'three-stdlib'
import type { StageGizmoMode } from '../domain/sceneTypes'

interface StageTransformControlsProps {
  object: Object3D
  mode: StageGizmoMode
  onObjectChange: () => void
}

interface DefaultControls {
  enabled: boolean
}

interface TransformEvent {
  type: string
  value?: boolean
}

interface StageTransformHandle extends Object3D {
  tag?: 'fwd' | 'bwd' | string
}

interface StageTransformGizmo extends Object3D {
  gizmo?: {
    translate?: Object3D
  }
  __stageTranslateArrowPatch?: boolean
}

interface StageTransformControlsRuntime {
  gizmo?: StageTransformGizmo
}

const TRANSLATE_AXES = ['X', 'Y', 'Z'] as const

const isStageTransformHandle = (handle: Object3D): handle is StageTransformHandle => (
  handle.name === 'X' || handle.name === 'Y' || handle.name === 'Z'
)

const stabilizeTranslateArrowDirections = (translateGizmo?: Object3D): void => {
  if (!translateGizmo) return

  for (const axis of TRANSLATE_AXES) {
    const axisHandles = translateGizmo.children.filter(
      (handle): handle is StageTransformHandle => isStageTransformHandle(handle) && handle.name === axis,
    )
    const forwardHandle = axisHandles.find((handle) => handle.tag === 'fwd')
    const backwardHandle = axisHandles.find((handle) => handle.tag === 'bwd')

    if (!forwardHandle || !backwardHandle || !backwardHandle.visible) continue

    forwardHandle.visible = true
    forwardHandle.scale.copy(backwardHandle.scale)
    forwardHandle.updateMatrix()
    forwardHandle.updateMatrixWorld(true)
    backwardHandle.visible = false
  }
}

const patchTranslateArrowDirections = (controls: TransformControlsImpl): void => {
  const gizmo = (controls as unknown as StageTransformControlsRuntime).gizmo
  if (!gizmo || gizmo.__stageTranslateArrowPatch) return

  const originalUpdateMatrixWorld = gizmo.updateMatrixWorld.bind(gizmo)
  gizmo.updateMatrixWorld = (force?: boolean): void => {
    originalUpdateMatrixWorld(force)
    stabilizeTranslateArrowDirections(gizmo.gizmo?.translate)
  }
  gizmo.__stageTranslateArrowPatch = true
}

const StageTransformControls = React.forwardRef<TransformControlsImpl, StageTransformControlsProps>(({
  object,
  mode,
  onObjectChange,
}, ref) => {
  const defaultControls = useThree((state) => (
    (state as unknown as { controls?: DefaultControls }).controls
  ))
  const gl = useThree((state) => state.gl)
  const events = useThree((state) => state.events)
  const defaultCamera = useThree((state) => state.camera)
  const invalidate = useThree((state) => state.invalidate)
  const domElement = events.connected ?? gl.domElement
  const controls = useMemo(() => {
    const nextControls = new TransformControlsImpl(defaultCamera, domElement)
    patchTranslateArrowDirections(nextControls)
    return nextControls
  }, [defaultCamera, domElement])
  const onObjectChangeRef = useRef(onObjectChange)

  useLayoutEffect(() => {
    onObjectChangeRef.current = onObjectChange
  }, [onObjectChange])

  useLayoutEffect(() => {
    controls.attach(object)
    return () => {
      controls.detach()
    }
  }, [controls, object])

  useEffect(() => {
    if (!defaultControls) return undefined

    const handleDraggingChanged = (event: TransformEvent): void => {
      defaultControls.enabled = !event.value
    }
    controls.addEventListener('dragging-changed', handleDraggingChanged)
    return () => {
      controls.removeEventListener('dragging-changed', handleDraggingChanged)
    }
  }, [controls, defaultControls])

  useEffect(() => {
    const handleChange = (): void => {
      invalidate()
    }
    const handleObjectChange = (): void => {
      onObjectChangeRef.current()
    }

    controls.addEventListener('change', handleChange)
    controls.addEventListener('objectChange', handleObjectChange)
    return () => {
      controls.removeEventListener('change', handleChange)
      controls.removeEventListener('objectChange', handleObjectChange)
    }
  }, [controls, invalidate])

  return (
    <primitive
      ref={ref}
      object={controls}
      mode={mode}
    />
  )
})

StageTransformControls.displayName = 'StageTransformControls'

export default StageTransformControls
