import React, { useCallback, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Grid, OrbitControls } from '@react-three/drei'
import type { Group } from 'three'
import { CAMERA_STAGE_COLOR_HEX } from '@/core/theme/colorTokens'
import { resolveCameraLookAtTarget } from '../domain/cameraUtils'
import type { StageCameraObject } from '../domain/sceneTypes'
import { useCameraStageStore } from '../store/cameraStageStore'
import StageCaptureBridge from './StageCaptureBridge'
import type { StageCaptureFn } from './StageCaptureBridge'
import StageObjectMesh from './StageObjectMesh'
import StagePlaybackDriver from './StagePlaybackDriver'
import StageViewportCamera from './StageViewportCamera'
import StageTransformControls from './StageTransformControls'

/**
 * 场景三维视图：数据驱动渲染 store 中的对象列表，
 * 选中对象挂 TransformControls，拖拽 gizmo 后把变换写回 store。
 */

const RAD2DEG = 180 / Math.PI

interface StageSceneProps {
  /** 截图函数注册位：机位视角下读取当前帧为 PNG dataURL */
  captureRef?: React.MutableRefObject<StageCaptureFn | null>
}

const StageScene: React.FC<StageSceneProps> = ({ captureRef }) => {
  const objects = useCameraStageStore((state) => state.objects)
  const selectedId = useCameraStageStore((state) => state.selectedId)
  const gizmoMode = useCameraStageStore((state) => state.gizmoMode)
  const viewMode = useCameraStageStore((state) => state.viewMode)
  const activeCameraId = useCameraStageStore((state) => state.activeCameraId)
  const setSelected = useCameraStageStore((state) => state.setSelected)
  const updateTransform = useCameraStageStore((state) => state.updateTransform)

  // 节点注册表用 state 而不是 ref：新对象"添加即选中"时，必须等它挂载注册后
  // 触发一次重渲染，TransformControls 才能立刻拿到节点（ref 版本不会重渲染，
  // 表现为刚添加的对象要点别处再点回来 gizmo 才出现）
  const [objectNodes, setObjectNodes] = useState<ReadonlyMap<string, Group>>(new Map())
  const objectNodesRef = useRef(objectNodes)
  objectNodesRef.current = objectNodes

  const registerNode = useCallback((id: string, node: Group | null): void => {
    setObjectNodes((prev) => {
      if (node ? prev.get(id) === node : !prev.has(id)) return prev
      const next = new Map(prev)
      if (node) {
        next.set(id, node)
      } else {
        next.delete(id)
      }
      return next
    })
  }, [])

  const handleGizmoChange = useCallback((): void => {
    const id = useCameraStageStore.getState().selectedId
    if (!id) return
    const node = objectNodesRef.current.get(id)
    if (!node) return
    updateTransform(id, {
      position: { x: node.position.x, y: node.position.y, z: node.position.z },
      rotation: {
        x: node.rotation.x * RAD2DEG,
        y: node.rotation.y * RAD2DEG,
        z: node.rotation.z * RAD2DEG,
      },
      scale: { x: node.scale.x, y: node.scale.y, z: node.scale.z },
    })
  }, [updateTransform])

  const selectedNode = selectedId ? objectNodes.get(selectedId) : undefined
  const selectedObject = selectedId ? objects.find((item) => item.id === selectedId) : undefined
  const transformMode = selectedObject?.type === 'camera' ? 'translate' : gizmoMode
  const cameraLookAtTargets = useMemo(() => {
    const targets = new Map<string, ReturnType<typeof resolveCameraLookAtTarget>>()
    for (const object of objects) {
      if (object.type === 'camera') {
        targets.set(object.id, resolveCameraLookAtTarget(object, objects))
      }
    }
    return targets
  }, [objects])
  const activeCamera = objects.find(
    (item): item is StageCameraObject => item.id === activeCameraId && item.type === 'camera',
  )
  const activeCameraTarget = activeCamera ? cameraLookAtTargets.get(activeCamera.id) : undefined
  const isCameraView = viewMode === 'camera' && !!activeCamera && !!activeCameraTarget

  return (
    <Canvas
      camera={{ position: [5, 4, 7], fov: 50 }}
      // preserveDrawingBuffer 让截图能读到当前帧；场景为静态摆拍，性能代价可忽略
      gl={{ preserveDrawingBuffer: true }}
      style={{ background: CAMERA_STAGE_COLOR_HEX.stageBg }}
      onPointerMissed={() => setSelected(null)}
    >
      {captureRef && <StageCaptureBridge captureRef={captureRef} />}
      <StagePlaybackDriver />
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 8, 4]} intensity={1.2} />
      {isCameraView && (
        <StageViewportCamera
          cameraObject={activeCamera}
          lookAtTarget={activeCameraTarget}
        />
      )}
      <Grid
        infiniteGrid
        cellSize={0.5}
        sectionSize={2.5}
        cellColor={CAMERA_STAGE_COLOR_HEX.gridCell}
        sectionColor={CAMERA_STAGE_COLOR_HEX.gridSection}
        fadeDistance={40}
      />
      {objects.map((object) => (
        <StageObjectMesh
          key={object.id}
          object={object}
          selected={object.id === selectedId}
          onSelect={setSelected}
          onRegister={registerNode}
          cameraLookAtTarget={cameraLookAtTargets.get(object.id)}
          showCameraHelpers={!isCameraView}
        />
      ))}
      {selectedNode && !isCameraView && (
        <StageTransformControls
          object={selectedNode}
          mode={transformMode}
          onObjectChange={handleGizmoChange}
        />
      )}
      {!isCameraView && <OrbitControls makeDefault />}
    </Canvas>
  )
}

export default StageScene
