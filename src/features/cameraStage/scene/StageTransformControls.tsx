import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import type { Object3D } from 'three'
import { TransformControls as TransformControlsImpl } from 'three-stdlib'
import type { StageGizmoMode } from '../domain/sceneTypes'
import { beginHistorySession, endHistorySession } from '../store/cameraStageStore'

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

type StageTransformEventType = 'dragging-changed' | 'change' | 'objectChange'

interface StageTransformEventSource {
  addEventListener: (type: StageTransformEventType, listener: (event: TransformEvent) => void) => void
  removeEventListener: (type: StageTransformEventType, listener: (event: TransformEvent) => void) => void
}

interface StageTransformHandle extends Object3D {
  tag?: 'fwd' | 'bwd' | string
}

interface StageTransformGizmoGroups {
  translate?: Object3D
  scale?: Object3D
}

interface StageTransformGizmo extends Object3D {
  gizmo?: StageTransformGizmoGroups
  picker?: StageTransformGizmoGroups
  __stageHandleStabilizePatch?: boolean
}

interface StageTransformControlsRuntime {
  gizmo?: StageTransformGizmo
}

const AXIS_NAMES = ['X', 'Y', 'Z'] as const
// XY/YZ/XZ 是 translate/scale 的平面拖拽柄；XYZX/XYZY/XYZZ 是 scale 模式的等比缩放角柄——
// 这些网格的名字同时包含两个及以上轴字母（如 "XYZX" 同时含 X/Y/Z），会被下面每根轴各自独立的
// 取反判断分别命中，且它们本身都未打 fwd/bwd 标签，因此统一按“多轴柄”处理。
const MULTI_AXIS_HANDLE_NAMES = ['XY', 'YZ', 'XZ', 'XYZX', 'XYZY', 'XYZZ'] as const

const AXIS_SCALE_KEY: Record<(typeof AXIS_NAMES)[number], 'x' | 'y' | 'z'> = {
  X: 'x',
  Y: 'y',
  Z: 'z',
}

const asStageHandles = (children: Object3D[]): StageTransformHandle[] => children as StageTransformHandle[]

// three-stdlib 的 TransformControls（translate / scale 两种模式共用同一段逻辑）会在相机越过
// 某根轴的垂直平面时（视线方向与轴方向点积过零），把该轴对应网格的 scale 分量整体取反。
// 对 translate 轴柄（一对 fwd/bwd 网格切换可见性）和 scale 轴柄（单个未打标签网格）来说，
// 视觉效果都是箭头/方块连同轴线突然镜像到轴的另一侧——这里把取反的分量还原回正值，
// 并让 translate 模式始终展示 fwd 网格，使轴的朝向不随视角变化。
const stabilizeAxisHandles = (root?: Object3D): void => {
  if (!root) return

  for (const axis of AXIS_NAMES) {
    const scaleKey = AXIS_SCALE_KEY[axis]
    const handles = asStageHandles(root.children).filter((handle) => handle.name === axis)
    const forwardHandle = handles.find((handle) => handle.tag === 'fwd')
    const backwardHandle = handles.find((handle) => handle.tag === 'bwd')

    // backwardHandle.visible 为 true 说明本帧发生了“翻到背面”的镜像；
    // 若两个箭头都被隐藏（正对着轴看的退化视角），保持库的默认隐藏行为不动。
    if (forwardHandle && backwardHandle && backwardHandle.visible) {
      forwardHandle.visible = true
      backwardHandle.visible = false
    }

    for (const handle of handles) {
      if (handle.tag === 'fwd' || handle.tag === 'bwd') continue
      if (!handle.visible || handle.scale[scaleKey] >= 0) continue
      handle.scale[scaleKey] *= -1
      handle.updateMatrix()
      handle.updateMatrixWorld(true)
    }
  }
}

const stabilizeMultiAxisHandles = (root?: Object3D): void => {
  if (!root) return

  for (const handleName of MULTI_AXIS_HANDLE_NAMES) {
    const handles = asStageHandles(root.children).filter((handle) => handle.name === handleName)

    for (const handle of handles) {
      if (!handle.visible) continue
      const flippedX = handle.scale.x < 0
      const flippedY = handle.scale.y < 0
      const flippedZ = handle.scale.z < 0
      if (!flippedX && !flippedY && !flippedZ) continue

      if (flippedX) handle.scale.x *= -1
      if (flippedY) handle.scale.y *= -1
      if (flippedZ) handle.scale.z *= -1
      handle.updateMatrix()
      handle.updateMatrixWorld(true)
    }
  }
}

const stabilizeHandleDirections = (root?: Object3D): void => {
  stabilizeAxisHandles(root)
  stabilizeMultiAxisHandles(root)
}

const patchGizmoHandleStabilization = (controls: TransformControlsImpl): void => {
  const gizmo = (controls as unknown as StageTransformControlsRuntime).gizmo
  if (!gizmo || gizmo.__stageHandleStabilizePatch) return

  const originalUpdateMatrixWorld = gizmo.updateMatrixWorld.bind(gizmo)
  gizmo.updateMatrixWorld = (force?: boolean): void => {
    originalUpdateMatrixWorld(force)
    // gizmo：肉眼可见的网格；picker：不可见的拾取网格。两者共用同一套翻转逻辑，
    // 必须同步稳定，否则会出现“看起来没翻，但点击/拖拽命中区域仍在另一侧”的错位。
    stabilizeHandleDirections(gizmo.gizmo?.translate)
    stabilizeHandleDirections(gizmo.gizmo?.scale)
    stabilizeHandleDirections(gizmo.picker?.translate)
    stabilizeHandleDirections(gizmo.picker?.scale)
  }
  gizmo.__stageHandleStabilizePatch = true
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
    patchGizmoHandleStabilization(nextControls)
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

    const controlEvents = controls as unknown as StageTransformEventSource
    const handleDraggingChanged = (event: TransformEvent): void => {
      defaultControls.enabled = !event.value
      // 一次 gizmo 拖拽合并为一条撤销记录：拖拽开始开会话，结束提交
      if (event.value) {
        beginHistorySession()
      } else {
        endHistorySession()
      }
    }
    controlEvents.addEventListener('dragging-changed', handleDraggingChanged)
    return () => {
      controlEvents.removeEventListener('dragging-changed', handleDraggingChanged)
    }
  }, [controls, defaultControls])

  useEffect(() => {
    const controlEvents = controls as unknown as StageTransformEventSource
    const handleChange = (): void => {
      invalidate()
    }
    const handleObjectChange = (): void => {
      onObjectChangeRef.current()
    }

    controlEvents.addEventListener('change', handleChange)
    controlEvents.addEventListener('objectChange', handleObjectChange)
    return () => {
      controlEvents.removeEventListener('change', handleChange)
      controlEvents.removeEventListener('objectChange', handleObjectChange)
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
