import React, { useCallback, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { Group } from 'three'
import { cameraTargetFromRotation, resolveCameraLookAtTarget } from '../domain/cameraUtils'
import type { StageCameraObject } from '../domain/sceneTypes'
import { useCameraStageStore } from '../store/cameraStageStore'
import DirectorViewTracker from './DirectorViewTracker'
import StageDirectorViewRestorer from './StageDirectorViewRestorer'
import StageCameraViewControls from './StageCameraViewControls'
import StageCaptureBridge from './StageCaptureBridge'
import type { StageCaptureFn } from './StageCaptureBridge'
import StageFocusController from './StageFocusController'
import StageGround from './StageGround'
import StageObjectMesh from './StageObjectMesh'
import StagePlaybackDriver from './StagePlaybackDriver'
import StageSunLight from './StageSunLight'
import StageViewportCamera from './StageViewportCamera'
import StageTransformControls from './StageTransformControls'
import StageMotionPathOverlay from './StageMotionPathOverlay'
import { useRenderCameraId } from './useRenderCameraId'

/**
 * 场景三维视图：数据驱动渲染 store 中的对象列表，
 * 选中对象挂 TransformControls，拖拽 gizmo 后把变换写回 store。
 */

const RAD2DEG = 180 / Math.PI

interface StageSceneProps {
  /** 截图函数注册位：摄像机视角下读取当前帧为 PNG dataURL */
  captureRef?: React.MutableRefObject<StageCaptureFn | null>
}

const StageScene: React.FC<StageSceneProps> = ({ captureRef }) => {
  const objects = useCameraStageStore((state) => state.objects)
  const selectedId = useCameraStageStore((state) => state.selectedId)
  const gizmoMode = useCameraStageStore((state) => state.gizmoMode)
  const viewMode = useCameraStageStore((state) => state.viewMode)
  // 渲染机位（重要记录 005，3.2）：简易模式播放/scrub 跨机位切换点时按时间表切换，与 activeCameraId
  // （编辑机位，用户显式选择）区分；专业模式/无镜头卡时该 hook 直接回落 activeCameraId，行为不变。
  const renderCameraId = useRenderCameraId()
  const sceneSettings = useCameraStageStore((state) => state.sceneSettings)
  const editorMode = useCameraStageStore((state) => state.editorMode)
  const shots = useCameraStageStore((state) => state.shots)
  const currentTime = useCameraStageStore((state) => state.playback.currentTime)
  const setSelected = useCameraStageStore((state) => state.setSelected)
  const updateTransform = useCameraStageStore((state) => state.updateTransform)
  const updateCameraView = useCameraStageStore((state) => state.updateCameraView)
  const prepareSimpleEdit = useCameraStageStore((state) => state.prepareSimpleEdit)

  // 节点注册表用 state 而不是 ref：新对象"添加即选中"时，必须等它挂载注册后
  // 触发一次重渲染，TransformControls 才能立刻拿到节点（ref 版本不会重渲染，
  // 表现为刚添加的对象要点别处再点回来 gizmo 才出现）
  const [objectNodes, setObjectNodes] = useState<ReadonlyMap<string, Group>>(new Map())
  const cameraViewInteractionRef = useRef(false)
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
    const rotation = {
      x: node.rotation.x * RAD2DEG,
      y: node.rotation.y * RAD2DEG,
      z: node.rotation.z * RAD2DEG,
    }
    const state = useCameraStageStore.getState()
    const object = state.objects.find((item) => item.id === id)
    const position = { x: node.position.x, y: node.position.y, z: node.position.z }
    if (object?.type === 'camera') {
      updateCameraView(id, {
        position,
        rotation,
        ...(state.gizmoMode === 'rotate'
          ? { lookAtTarget: cameraTargetFromRotation(object, state.objects, rotation) }
          : {}),
      })
      return
    }
    updateTransform(id, {
      position,
      rotation,
      scale: { x: node.scale.x, y: node.scale.y, z: node.scale.z },
    })
  }, [updateCameraView, updateTransform])

  const handleGizmoInteractionStart = useCallback((): void => {
    const id = useCameraStageStore.getState().selectedId
    if (id) prepareSimpleEdit(id)
  }, [prepareSimpleEdit])

  const selectedNode = selectedId ? objectNodes.get(selectedId) : undefined
  const selectedObject = selectedId ? objects.find((item) => item.id === selectedId) : undefined
  const editingSpatialPath = !!selectedId && shots.some((shot, index) => (
    !!shot.transition.perObject[selectedId]?.spatialPath
    && currentTime >= shot.time
    && currentTime <= (shots[index + 1]?.time ?? shot.time)
  ))
  const transformMode = selectedObject?.type === 'camera' && gizmoMode === 'scale' ? 'translate' : gizmoMode
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
    (item): item is StageCameraObject => item.id === renderCameraId && item.type === 'camera',
  )
  const activeCameraTarget = activeCamera ? cameraLookAtTargets.get(activeCamera.id) : undefined
  const isCameraView = viewMode === 'camera' && !!activeCamera && !!activeCameraTarget
  // 简易模式播放头落在过渡段时视口只读（重要记录 003）：隐藏 gizmo，阻断手动编辑插值状态
  const fogNear = Math.max(12, sceneSettings.fog.distance * 0.38)
  const fogFar = Math.max(fogNear + 1, sceneSettings.fog.distance)

  return (
    <Canvas
      // 初始机位与 DEFAULT_DIRECTOR_VIEW 对齐（正对场景、略俯视），避免恢复器首帧生效前闪一下斜视角
      camera={{ position: [0, 4.2, 9], fov: 50 }}
      // preserveDrawingBuffer 让截图能读到当前帧；场景为静态摆拍，性能代价可忽略
      gl={{ preserveDrawingBuffer: true, alpha: false }}
      style={{ background: sceneSettings.sky.color }}
      onPointerMissed={() => setSelected(null)}
    >
      <color attach="background" args={[sceneSettings.sky.color]} />
      {sceneSettings.fog.enabled && (
        <fog
          key={`scene-fog-${sceneSettings.sky.color}-${fogNear}-${fogFar}`}
          attach="fog"
          args={[sceneSettings.sky.color, fogNear, fogFar]}
        />
      )}
      {captureRef && <StageCaptureBridge captureRef={captureRef} />}
      <StagePlaybackDriver />
      <StageSunLight settings={sceneSettings} />
      <StageGround
        key={`stage-ground-${sceneSettings.ground.pattern}`}
        settings={sceneSettings.ground}
      />
      {isCameraView && (
        <>
          <StageViewportCamera
            cameraObject={activeCamera}
            lookAtTarget={activeCameraTarget}
            interactionRef={cameraViewInteractionRef}
          />
          {activeCamera.lookAt.mode === 'manual' && (
            <StageCameraViewControls
              cameraObject={activeCamera}
              lookAtTarget={activeCameraTarget}
              interactionRef={cameraViewInteractionRef}
            />
          )}
        </>
      )}
      {objects.map((object) => (
        <StageObjectMesh
          key={object.id}
          object={object}
          selected={object.id === selectedId}
          onSelect={setSelected}
          onRegister={registerNode}
          cameraLookAtTarget={cameraLookAtTargets.get(object.id)}
          showCameraHelpers={!isCameraView}
          showNameLabel={sceneSettings.display.showNameLabels && !(isCameraView && object.id === activeCamera?.id)}
          nameLabelSettings={sceneSettings.display.nameLabel}
        />
      ))}
      {editorMode === 'simple' && viewMode === 'director' && selectedId && (
        <StageMotionPathOverlay objectId={selectedId} shots={shots} currentTime={currentTime} />
      )}
      {selectedNode && !editingSpatialPath && (!isCameraView || selectedObject?.id !== activeCamera?.id) && (
        <StageTransformControls
          object={selectedNode}
          mode={transformMode}
          enabled
          onInteractionStart={handleGizmoInteractionStart}
          onObjectChange={handleGizmoChange}
        />
      )}
      {!isCameraView && (
        <>
          <OrbitControls makeDefault enableDamping={false} />
          <StageDirectorViewRestorer />
          <StageFocusController />
          <DirectorViewTracker />
        </>
      )}
    </Canvas>
  )
}

export default StageScene
