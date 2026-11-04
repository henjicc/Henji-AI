import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Color, EquirectangularReflectionMapping, SRGBColorSpace, TextureLoader, type Group } from 'three'
import { createLogger } from '@/core/logging'
import { resolveImageDisplayUrl } from '@/services/imageSource'
import { cameraTargetFromRotation, resolveCameraLookAtTarget } from '../domain/cameraUtils'
import type { StageCameraObject, StageObject, StagePrimitiveObject, StageSet } from '../domain/sceneTypes'
import { liveStageSets } from '../domain/stageSets'
import { isStageStyleRenderStyle } from '../render/stageStyleRenderer'
import { cameraStageStoreAttachment, useCameraStageStore, type CameraStageOwnedStore } from '../store/cameraStageStore'
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
import StageDemandFrames from './StageDemandFrames'
import StageNameLabelLayer from './StageNameLabelLayer'
import StagePrimitiveBatch from './StagePrimitiveBatch'
import StageSetDecorLayer from './StageSetDecorLayer'
import { StagePrimitiveResourcesProvider } from './stagePrimitiveResources'
import { useRenderCameraId } from './useRenderCameraId'
import type { StageViewportSource } from '../viewport/viewportTypes'
import StageFixedViewportCamera from './StageFixedViewportCamera'
import StageEditorViewRange from './StageEditorViewRange'
import { resolveStageSceneExtent, stageGroundSize } from '../application/stageSceneExtent'
import { buildRenderCameraSchedule } from '../domain/renderCameraSchedule'
import { useSyncExternalStore } from 'react'
import { cameraMotionPreview, subscribeCameraMotion, cameraMotionRevision, demonstrateCameraMotion, cameraMotionDraft } from '../application/cameraMotionDraft'

/**
 * 场景三维视图：数据驱动渲染 store 中的对象列表，
 * 选中对象挂 TransformControls，拖拽 gizmo 后把变换写回 store。
 */

const RAD2DEG = 180 / Math.PI
const logger = createLogger('cameraStage.environment')

function StageEnvironment({ imageUrl, fallbackColor, onAssetReady }: { imageUrl: string; fallbackColor: string; onAssetReady?: (id: string, error?: unknown) => void }): null {
  const scene = useThree((state) => state.scene)
  const invalidate = useThree((state) => state.invalidate)

  useEffect(() => {
    let disposed = false
    let appliedTexture: ReturnType<TextureLoader['load']> | null = null
    const previousBackground = scene.background
    const previousEnvironment = scene.environment
    const fallbackBackground = new Color(fallbackColor)
    scene.background = fallbackBackground
    logger.info('3D 全景环境加载开始', {
      event: 'camera_stage.environment.load.start',
      context: { enabled: true },
    })
    const loader = new TextureLoader()
    appliedTexture = loader.load(
      resolveImageDisplayUrl(imageUrl),
      (texture) => {
        if (disposed) return
        texture.mapping = EquirectangularReflectionMapping
        texture.colorSpace = SRGBColorSpace
        texture.needsUpdate = true
        scene.background = texture
        scene.environment = texture
        // 按需渲染：异步贴图落位不经过 React 属性，要自己请求一帧
        invalidate()
        onAssetReady?.('environment')
        logger.info('3D 全景环境加载完成', {
          event: 'camera_stage.environment.load.completed',
          context: { enabled: true },
        })
      },
      undefined,
      (error) => {
        if (disposed) return
        onAssetReady?.('environment', error)
        logger.error('3D 全景环境加载失败', error, {
          event: 'camera_stage.environment.load.failed',
          context: { enabled: true },
        })
      },
    )
    return () => {
      disposed = true
      if (scene.background === appliedTexture || scene.background === fallbackBackground) {
        scene.background = previousBackground
      }
      if (scene.environment === appliedTexture) scene.environment = previousEnvironment
      appliedTexture?.dispose()
    }
  }, [fallbackColor, imageUrl, invalidate, onAssetReady, scene])

  return null
}

/**
 * 路径工具跟随播放头选中当前状态关键帧段。播放头订阅只放在这里：放进 StageScene 会让
 * 播放与 seek 时整棵场景（上千个物体）跟着重渲染。
 */
function StagePathSelectionSync({ selectedId }: { selectedId: string | null }): null {
  const editorTool = useCameraStageToolStore((state) => state.tool)
  const stateKeyframes = useCameraStageStore((state) => state.stateKeyframes)
  const selectedStateKeyframeId = useCameraStageStore((state) => state.selectedStateKeyframeId)
  const currentTime = useCameraStageStore((state) => state.playback.currentTime)
  const automaticPathStateKeyframeId = useMemo(
    () => resolvePathStateKeyframeId(stateKeyframes, currentTime, selectedStateKeyframeId),
    [currentTime, selectedStateKeyframeId, stateKeyframes],
  )

  useEffect(() => {
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
  }, [automaticPathStateKeyframeId, editorTool, selectedId])

  return null
}

interface StageSceneProps {
  onAssetReady?: (id: string, error?: unknown) => void
  /** 截图函数注册位：摄像机视角下读取当前帧为 PNG dataURL */
  captureRef?: React.MutableRefObject<StageCaptureFn | null>
  viewportSource?: StageViewportSource
  interactive?: boolean
  primary?: boolean
}

const StageScene: React.FC<StageSceneProps> = ({
  onAssetReady,
  captureRef,
  viewportSource,
  interactive = true,
  primary = true,
}) => {
  const storedObjects = useCameraStageStore((state) => state.objects)
  const sets = useCameraStageStore((state) => state.sets)
  useSyncExternalStore(subscribeCameraMotion, cameraMotionRevision)
  const selectedId = useCameraStageStore((state) => state.selectedId)
  const gizmoMode = useCameraStageStore((state) => state.gizmoMode)
  const viewMode = useCameraStageStore((state) => state.viewMode)
  const activeCameraId = useCameraStageStore((state) => state.activeCameraId)
  // 播放/scrub 跨机位切换点时按状态关键帧时间表切换，与 activeCameraId（编辑机位）区分。
  const renderCameraId = useRenderCameraId()
  const sceneSettings = useCameraStageStore((state) => state.sceneSettings)
  const renderStyle = useCameraStageStore((state) => state.sceneSettings.render.style)
  const stateKeyframes = useCameraStageStore((state) => state.stateKeyframes)
  const objects = cameraMotionPreview(useCameraStageStore.getState())?.objects ?? storedObjects
  const setSelected = useCameraStageStore((state) => state.setSelected)
  const updateTransform = useCameraStageStore((state) => state.updateTransform)
  const updateCameraView = useCameraStageStore((state) => state.updateCameraView)
  const prepareStateKeyframeEdit = useCameraStageStore((state) => state.prepareStateKeyframeEdit)
  const editorTool = useCameraStageToolStore((state) => state.tool)
  const pathSelection = useCameraStageToolStore((state) => state.pathSelection)

  // 节点注册表用 state 而不是 ref：新对象"添加即选中"时，必须等它挂载注册后
  // 触发一次重渲染，TransformControls 才能立刻拿到节点（ref 版本不会重渲染，
  // 表现为刚添加的对象要点别处再点回来 gizmo 才出现）
  const [objectNodes, setObjectNodes] = useState<ReadonlyMap<string, Group>>(new Map())
  const cameraViewInteractionRef = useRef(false)
  const objectNodesRef = useRef(objectNodes)
  objectNodesRef.current = objectNodes
  // 名称标签逐帧读取；注册当场生效，不等 state 提交
  const liveObjectNodesRef = useRef(new Map<string, Group>())

  const registerNode = useCallback((id: string, node: Group | null): void => {
    if (node) liveObjectNodesRef.current.set(id, node)
    else liveObjectNodesRef.current.delete(id)
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
      if (state.currentProjectId && demonstrateCameraMotion(state.currentProjectId, id, { position, rotation })) return
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

  const handleSelect = useCallback((id: string): void => {
    if (interactive) setSelected(id)
  }, [interactive, setSelected])

  const handleGizmoInteractionStart = useCallback((): void => {
    const state = useCameraStageStore.getState(), id = state.selectedId
    if (state.currentProjectId && cameraMotionDraft(state.currentProjectId)?.status === 'recording' && cameraMotionDraft(state.currentProjectId)?.cameraId === id) return
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
  const cameraObjects = useMemo(
    () => objects.filter((object): object is StageCameraObject => object.type === 'camera'),
    [objects],
  )
  const renderCameraSchedule = useMemo(
    () => buildRenderCameraSchedule(stateKeyframes, activeCameraId),
    [activeCameraId, stateKeyframes],
  )
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
  // 正交视图是量位置用的技术视图，相机离场景几千米，雾只会把它整个吞掉
  const fogVisible = sceneSettings.fog.enabled && !isFixedView
  const editorFog = useMemo(() => (fogVisible ? { near: fogNear, far: fogFar } : null), [fogFar, fogNear, fogVisible])
  // 裁剪面与地面只跟着存下来的对象走：运镜示范的临时预览不改变场景尺度
  const sceneExtent = useMemo(() => resolveStageSceneExtent(storedObjects), [storedObjects])
  const groundSize = stageGroundSize(sceneExtent)

  // 未选中的可见基础几何体进合批，不挂逐物体组件；隐藏又没选中的什么都不挂
  const { batchedPrimitives, meshObjects } = useMemo(() => {
    const batched: StagePrimitiveObject[] = []
    const meshes: StageObject[] = []
    for (const object of objects) {
      if (object.type !== 'primitive' || object.id === selectedId) meshes.push(object)
      else if (object.visible) batched.push(object)
    }
    return { batchedPrimitives: batched, meshObjects: meshes }
  }, [objects, selectedId])
  // 装饰只跟着布景走：对象每次编辑都会换引用，布景列表没变时沿用上一次的数组，装饰层不重建。
  const liveSetsRef = useRef<StageSet[]>([])
  const liveSets = useMemo(() => {
    const next = liveStageSets(sets, storedObjects)
    const previous = liveSetsRef.current
    if (next.length === previous.length && next.every((set, index) => set === previous[index])) return previous
    liveSetsRef.current = next
    return next
  }, [sets, storedObjects])
  const showNameLabels = sceneSettings.display.showNameLabels
  const framingCameraId = isCameraView ? activeCamera?.id : undefined
  const labelObjects = useMemo(() => (showNameLabels
    ? objects.filter((object) => object.visible && object.name.trim() !== '' && object.id !== framingCameraId)
    : []), [framingCameraId, objects, showNameLabels])

  return (
    <Canvas
      key={isFixedView ? viewportSource.view : viewportSource?.kind ?? 'legacy'}
      orthographic={isFixedView}
      // 初始机位与 DEFAULT_DIRECTOR_VIEW 对齐（正对场景、略俯视），避免恢复器首帧生效前闪一下斜视角
      camera={canvasCamera}
      // preserveDrawingBuffer 让截图能读到当前帧；场景为静态摆拍，性能代价可忽略
      gl={{ preserveDrawingBuffer: true, alpha: false }}
      // 摆场景时画面大多静止：只在 store、控制器、播放或资源变化时出帧，见 StageDemandFrames
      frameloop="demand"
      style={{ background: sceneSettings.sky.color }}
      onPointerMissed={() => interactive && setSelected(null)}
    >
      <StageDemandFrames />
      {interactive && <StagePathSelectionSync selectedId={selectedId} />}
      {sceneSettings.sky.environmentImageUrl ? (
        <StageEnvironment
          imageUrl={sceneSettings.sky.environmentImageUrl}
          fallbackColor={sceneSettings.sky.color}
          onAssetReady={onAssetReady}
        />
      ) : (
        <color attach="background" args={[sceneSettings.sky.color]} />
      )}
      {isFixedView && <StageFixedViewportCamera view={viewportSource.view} />}
      {fogVisible && (
        <fog
          key={`scene-fog-${sceneSettings.sky.color}-${fogNear}-${fogFar}`}
          attach="fog"
          args={[sceneSettings.sky.color, fogNear, fogFar]}
        />
      )}
      {primary && captureRef && <StageCaptureBridge captureRef={captureRef} coverRefresh={(cameraStageStoreAttachment.getStore() as CameraStageOwnedStore).coverRefresh} />}
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
        size={groundSize}
      />
      {isCameraView && activeCamera && activeCameraTarget && (
        <>
          <StageViewportCamera
            cameraObject={activeCamera}
            lookAtTarget={activeCameraTarget}
            interactionRef={cameraViewInteractionRef}
            cameraObjects={cameraObjects}
            lookAtTargets={cameraLookAtTargets}
            renderCameraSchedule={viewportSource?.kind === 'camera' ? null : renderCameraSchedule}
            fallbackCameraId={activeCameraId}
            sceneExtent={sceneExtent}
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
      {liveSets.length > 0 && <StageSetDecorLayer sets={liveSets} onAssetReady={onAssetReady} />}
      <StagePrimitiveResourcesProvider onSelect={handleSelect}>
        <StagePrimitiveBatch objects={batchedPrimitives} />
        {meshObjects.map((object) => (
          <StageObjectMesh
            key={object.id}
            onAssetReady={onAssetReady}
            object={object}
            selected={object.id === selectedId}
            onSelect={handleSelect}
            onRegister={registerNode}
            cameraLookAtTarget={cameraLookAtTargets.get(object.id)}
            showCameraHelpers={!isCameraView}
          />
        ))}
        {labelObjects.length > 0 && (
          <StageNameLabelLayer
            objects={labelObjects}
            settings={sceneSettings.display.nameLabel}
            nodes={liveObjectNodesRef}
          />
        )}
      </StagePrimitiveResourcesProvider>
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
          <StageEditorViewRange extent={sceneExtent} fixedView={isFixedView} fog={editorFog} />
        </>
      )}
    </Canvas>
  )
}

export default memo(StageScene)
