import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { Group } from 'three'
import { cameraTargetFromRotation, resolveCameraLookAtTarget } from '../domain/cameraUtils'
import type { StageCameraObject } from '../domain/sceneTypes'
import { isStageStyleRenderStyle } from '../render/stageStyleRenderer'
import { useCameraStageStore } from '../store/cameraStageStore'
import { resolvePathStateKeyframeId, useCameraStageToolStore } from '../store/cameraStageToolStore'
import DirectorViewTracker from './DirectorViewTracker'
import StageDirectorViewRestorer from './StageDirectorViewRestorer'
import StageCameraViewControls from './StageCameraViewControls'
import StageCaptureBridge from './StageCaptureBridge'
import type { StageCaptureFn } from './StageCaptureBridge'
import StageFocusController from './StageFocusController'
import StageGround from './StageGround'
import StageObjectMesh from './StageObjectMesh'
import StageStyleRenderLayer from './StageStyleRenderLayer'
import StagePlaybackDriver from './StagePlaybackDriver'
import StageSunLight from './StageSunLight'
import StageViewportCamera from './StageViewportCamera'
import StageTransformControls from './StageTransformControls'
import StageMotionPathOverlay from './StageMotionPathOverlay'
import { useRenderCameraId } from './useRenderCameraId'
import type { StageViewportSource } from '../viewport/viewportTypes'
import StageFixedViewportCamera from './StageFixedViewportCamera'

/**
 * 场景三维视图：数据驱动渲染 store 中的对象列表，
 * 选中对象挂 TransformControls，拖拽 gizmo 后把变换写回 store。
 */

const RAD2DEG = 180 / Math.PI

interface StageSceneProps {
  /** 截图函数注册位：摄像机视角下读取当前帧为 PNG dataURL */
  captureRef?: React.MutableRefObject<StageCaptureFn | null>
  viewportSource?: StageViewportSource
  interactive?: boolean
  primary?: boolean
}

const StageScene: React.FC<StageSceneProps> = ({
  captureRef,
  viewportSource,
  interactive = true,
  primary = true,
}) => {
  const objects = useCameraStageStore((state) => state.objects)
  const selectedId = useCameraStageStore((state) => state.selectedId)
  const gizmoMode = useCameraStageStore((state) => state.gizmoMode)
  const viewMode = useCameraStageStore((state) => state.viewMode)
  // 播放/scrub 跨机位切换点时按状态关键帧时间表切换，与 activeCameraId（编辑机位）区分。
  const renderCameraId = useRenderCameraId()
  const sceneSettings = useCameraStageStore((state) => state.sceneSettings)
  const renderStyle = useCameraStageStore((state) => state.sceneSettings.render.style)
  const stateKeyframes = useCameraStageStore((state) => state.stateKeyframes)
  const selectedStateKeyframeId = useCameraStageStore((state) => state.selectedStateKeyframeId)
  const currentTime = useCameraStageStore((state) => state.playback.currentTime)
  const setSelected = useCameraStageStore((state) => state.setSelected)
  const updateTransform = useCameraStageStore((state) => state.updateTransform)
  const updateCameraView = useCameraStageStore((state) => state.updateCameraView)
  const prepareStateKeyframeEdit = useCameraStageStore((state) => state.prepareStateKeyframeEdit)
  const editorTool = useCameraStageToolStore((state) => state.tool)
  const pathSelection = useCameraStageToolStore((state) => state.pathSelection)
  const automaticPathStateKeyframeId = useMemo(
    () => resolvePathStateKeyframeId(stateKeyframes, currentTime, selectedStateKeyframeId),
    [currentTime, selectedStateKeyframeId, stateKeyframes],
  )

  useEffect(() => {
    if (!interactive) return
    const tools = useCameraStageToolStore.getState()
    if (tools.tool !== 'path') return
    if (!selectedId || !automaticPathStateKeyframeId) {
      tools.clearPathSelection()
      return
    }
    if (tools.pathSelection?.objectId !== selectedId
      || tools.pathSelection.stateKeyframeId !== automaticPathStateKeyframeId) {
      tools.selectPath({ stateKeyframeId: automaticPathStateKeyframeId, objectId: selectedId })
    }
  }, [automaticPathStateKeyframeId, editorTool, interactive, selectedId])

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
    if (id) prepareStateKeyframeEdit(id)
  }, [prepareStateKeyframeEdit])

  const selectedNode = selectedId ? objectNodes.get(selectedId) : undefined
  const selectedObject = selectedId ? objects.find((item) => item.id === selectedId) : undefined
  const editingSpatialPath = editorTool === 'path'
    && pathSelection?.objectId === selectedId
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
  /*
   * `active_camera` 走 renderCameraId 而不是 activeCameraId：播放/scrub 跨机位切换点时
   * 渲染机位按状态关键帧时间表走（重要记录 005），跟随档要跟的是**画面上真正在用的那台**，
   * 否则播放到切机位那一刻，跟随窗格还停在上一台机器上。
   */
  const requestedCameraId = viewportSource?.kind === 'camera'
    ? viewportSource.cameraId
    : !viewportSource || viewportSource.kind === 'active_camera'
      ? renderCameraId
      : null
  const activeCamera = objects.find(
    (item): item is StageCameraObject => item.id === requestedCameraId && item.type === 'camera',
  )
  const activeCameraTarget = activeCamera ? cameraLookAtTargets.get(activeCamera.id) : undefined
  const isCameraView = viewportSource
    ? (viewportSource.kind === 'camera' || viewportSource.kind === 'active_camera')
      && !!activeCamera && !!activeCameraTarget
    : viewMode === 'camera' && !!activeCamera && !!activeCameraTarget
  const isFixedView = viewportSource?.kind === 'fixed'
  const canvasCamera = isFixedView
    ? { position: [0, 0, 20] as [number, number, number], zoom: 45, near: 0.01, far: 2000 }
    : { position: [0, 4.2, 9] as [number, number, number], fov: 50 }
  // 播放头落在过渡段时视口只读：隐藏 gizmo，阻断手动编辑插值状态
  const fogNear = Math.max(12, sceneSettings.fog.distance * 0.38)
  const fogFar = Math.max(fogNear + 1, sceneSettings.fog.distance)

  return (
    <Canvas
      key={isFixedView ? viewportSource.view : viewportSource?.kind ?? 'legacy'}
      orthographic={isFixedView}
      // 初始机位与 DEFAULT_DIRECTOR_VIEW 对齐（正对场景、略俯视），避免恢复器首帧生效前闪一下斜视角
      camera={canvasCamera}
      // preserveDrawingBuffer 让截图能读到当前帧；场景为静态摆拍，性能代价可忽略
      gl={{ preserveDrawingBuffer: true, alpha: false }}
      style={{ background: sceneSettings.sky.color }}
      onPointerMissed={() => interactive && setSelected(null)}
    >
      <color attach="background" args={[sceneSettings.sky.color]} />
      {isFixedView && <StageFixedViewportCamera view={viewportSource.view} />}
      {sceneSettings.fog.enabled && (
        <fog
          key={`scene-fog-${sceneSettings.sky.color}-${fogNear}-${fogFar}`}
          attach="fog"
          args={[sceneSettings.sky.color, fogNear, fogFar]}
        />
      )}
      {primary && captureRef && <StageCaptureBridge captureRef={captureRef} />}
      {/*
        * 渲染方式只接管摄像机画面：导演视角要保留彩色渲染，否则手柄、路径、辅助线全被
        * 覆盖材质吃掉，摆场景就没法看了。成片（截图/导出/画布渲染）都走摄像机画面。
        */}
      {isCameraView && isStageStyleRenderStyle(renderStyle) && <StageStyleRenderLayer style={renderStyle} />}
      {primary && <StagePlaybackDriver />}
      <StageSunLight settings={sceneSettings} />
      <StageGround
        key={`stage-ground-${sceneSettings.ground.pattern}`}
        settings={sceneSettings.ground}
      />
      {isCameraView && activeCamera && activeCameraTarget && (
        <>
          <StageViewportCamera
            cameraObject={activeCamera}
            lookAtTarget={activeCameraTarget}
            interactionRef={cameraViewInteractionRef}
          />
          {interactive && activeCamera.lookAt.mode === 'manual' && (
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
          onSelect={(id) => interactive && setSelected(id)}
          onRegister={registerNode}
          cameraLookAtTarget={cameraLookAtTargets.get(object.id)}
          showCameraHelpers={!isCameraView}
          showNameLabel={sceneSettings.display.showNameLabels && !(isCameraView && object.id === activeCamera?.id)}
          nameLabelSettings={sceneSettings.display.nameLabel}
        />
      ))}
      {!isCameraView && selectedId && (
        <StageMotionPathOverlay objectId={selectedId} stateKeyframes={stateKeyframes} editable={interactive} />
      )}
      {interactive && selectedNode
        && (editorTool === 'translate' || editorTool === 'rotate' || editorTool === 'scale')
        && !editingSpatialPath
        && (!isCameraView || selectedObject?.id !== activeCamera?.id) && (
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
          <OrbitControls makeDefault enableDamping={false} enableRotate={!isFixedView} />
          {!isFixedView && <StageDirectorViewRestorer />}
          {interactive && <StageFocusController />}
          {!isFixedView && primary && <DirectorViewTracker />}
        </>
      )}
    </Canvas>
  )
}

export default StageScene
