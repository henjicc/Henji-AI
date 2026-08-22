import { create } from 'zustand'
import type { StoreApi } from 'zustand'
import { temporal } from 'zundo'
import { v4 as uuidv4 } from 'uuid'
import {
  PRIMITIVE_KIND_LABELS,
  createCameraObject,
  createCharacterObject,
  createDefaultSceneSettings,
  createPrimitiveObject,
  pickDefaultColor,
} from '../domain/sceneDefaults'
import { createPoseMotion } from '../domain/characterMotion'
import { applyObjectPatch, getCameraObjects, isCameraId } from '../domain/cameraUtils'
import { getDirectorView, resetDirectorView } from '../scene/directorViewState'
import { clonePose } from '../domain/poseTypes'
import type { StageRenderStyle } from '../domain/renderStyles'
import type { StagePoseJointId, StagePosePreset } from '../domain/poseTypes'
import type { StageSceneRuntimeSnapshot } from '../domain/sceneSerialization'
import {
  createStateKeyframe,
  type StageStateKeyframe,
} from '../domain/stateKeyframeTypes'
import { compileStateKeyframesToAnimation } from '../domain/stateKeyframeCompiler'
import { quantizeToFrame } from '../stateKeyframes/timeline/stateKeyframeClipGeometry'
import {
  createDefaultPlayback,
  type StagePlaybackState,
  type StageSceneAnimation,
} from '../domain/animationTypes'
import {
  compileStateKeyframeEdit,
  createStateKeyframeSlice,
  syncCameraLookAtAcrossStateKeyframes,
  syncAddedObjectToStateKeyframes,
  syncRemovedObjectFromStateKeyframes,
  type StateKeyframeTimingPatch,
  type StateKeyframeTransitionPatch,
} from './stateKeyframeSlice'
import { applyAnimationAtTime } from './playbackSampling'
import type { CameraStagePathActions } from './pathActionTypes'
import type {
  StageGizmoMode,
  StageObject,
  StageObjectPatch,
  StagePrimitiveKind,
  StageSceneSettings,
  StageTransform,
  StageVec3,
  StageViewMode,
} from '../domain/sceneTypes'

export interface CameraStageState extends CameraStagePathActions {
  objects: StageObject[]
  selectedId: string | null
  gizmoMode: StageGizmoMode
  viewMode: StageViewMode
  activeCameraId: string | null
  /** 当前已保存工程 id；null 表示尚未保存过（新场景） */
  currentProjectId: string | null
  /** 当前工程名（新场景用默认名，保存后与工程记录一致） */
  currentProjectName: string
  /** 由状态关键帧编译出的播放数据；不单独持久化。 */
  animation: StageSceneAnimation
  /** 播放界面态（不进撤销历史、不持久化） */
  playback: StagePlaybackState
  /** 场景级设置（背景色/网格显隐），随工程持久化，不进撤销历史 */
  sceneSettings: StageSceneSettings
  /** 唯一可编辑时间轴真相源，随工程持久化。 */
  stateKeyframes: StageStateKeyframe[]
  selectedStateKeyframeId: string | null
  /** 时间轴框选出的多个状态关键帧 id（界面态，不持久化、不进撤销历史） */
  selectedStateKeyframeIds: string[]
  /** 聚焦选中对象请求令牌：每次递增触发一次视口平滑对准，界面态 */
  focusToken: number
  addStateKeyframe: () => void
  moveStateKeyframeTime: (id: string, time: number) => void
  removeStateKeyframe: (id: string) => void
  /** 批量删除状态关键帧（框选后按 Delete），一次 set 合并为单条撤销记录 */
  removeStateKeyframes: (ids: string[]) => void
  setSelectedStateKeyframeIds: (ids: string[]) => void
  reorderStateKeyframe: (id: string, toIndex: number) => void
  selectStateKeyframe: (id: string) => void
  /** 只更新 selectedStateKeyframeId，不应用快照/不移动播放头（界面态，不进撤销历史）；scrub 跟随选中用 */
  setSelectedStateKeyframeIdOnly: (id: string) => void
  updateStateKeyframeTiming: (id: string, patch: StateKeyframeTimingPatch) => void
  updateStateKeyframeName: (id: string, name: string) => void
  updateStateKeyframeTransition: (id: string, patch: StateKeyframeTransitionPatch) => void
  /** 修改状态关键帧拍摄机位（重要记录 005）；null = 取消指定，沿用全局 activeCameraId */
  updateStateKeyframeCamera: (id: string, cameraId: string | null) => void
  updateStateKeyframeContinuity: (id: string, continuity: StageStateKeyframe['continuity']) => void
  captureIntoSelectedStateKeyframe: (objectIds?: string[]) => void
  addPrimitive: (kind: StagePrimitiveKind) => void
  addCharacter: () => void
  addCamera: () => void
  /** 深拷贝复制对象（含角色姿态/摄像机设置），名称自动递增，复制后自动选中 */
  duplicateObject: (id: string) => void
  removeObject: (id: string) => void
  setSelected: (id: string | null) => void
  setGizmoMode: (mode: StageGizmoMode) => void
  setViewMode: (mode: StageViewMode) => void
  setActiveCameraId: (id: string | null) => void
  updateObject: (id: string, patch: StageObjectPatch) => void
  /** 建模语义写入：改动同步进所有状态关键帧，不在单一时间点产生动画（助手与批量写入用）。 */
  updateObjectAcrossStateKeyframes: (id: string, patch: StageObjectPatch) => void
  /** 交互开始前冻结当前帧，避免首个变换增量中途触发插帧重编译。 */
  prepareStateKeyframeEdit: (id: string) => void
  updateTransform: (id: string, patch: Partial<StageTransform>, changedPaths?: string[]) => void
  /** 原子更新摄像机视图姿态，避免 OrbitControls 一次 change 被拆成多次编译。 */
  updateCameraView: (id: string, patch: {
    position?: StageVec3
    rotation?: StageVec3
    lookAtTarget?: StageVec3
  }) => void
  /** 更新角色单个关节的欧拉偏移（角度制） */
  updatePoseJoint: (id: string, jointId: StagePoseJointId, euler: StageVec3, changedPaths?: string[]) => void
  /** 一键应用预设姿势（整体替换当前姿态） */
  applyPosePreset: (id: string, preset: StagePosePreset) => void
  /** 关联到某个已保存工程（保存/加载后调用），仅更新工程标识不动场景数据 */
  bindProject: (id: string, name: string) => void
  /** 重置为空白新场景（新建工程用）：清空对象与工程标识，复位界面态 */
  newScene: (name: string) => void
  /** 用工程快照整体重置场景（加载工程用）；同时复位选中/视角等界面态 */
  loadSnapshot: (snapshot: StageSceneRuntimeSnapshot, project: { id: string; name: string }) => void

  /* ---- 播放/时间轴界面态动作（非 tracked） ---- */
  play: () => void
  pause: () => void
  stop: () => void
  /** 定位播放头：非播放态下同时把采样值落回对象（scrub），播放态仅移动播放头 */
  seek: (time: number) => void
  /** 播放驱动低频回写播放头（不落对象、不进历史） */
  setPlaybackTime: (time: number) => void
  toggleLoop: () => void

  /* ---- 场景设置 / 视口交互动作（非 tracked） ---- */
  setSceneGroundColor: (color: string) => void
  setSceneGroundPattern: (pattern: StageSceneSettings['ground']['pattern']) => void
  setSceneGroundDensity: (density: number) => void
  setSceneGroundGridLineColor: (color: string) => void
  setSceneGroundGridLineThickness: (thickness: number) => void
  setSceneGroundCheckerLightColor: (color: string) => void
  setSceneGroundCheckerDarkColor: (color: string) => void
  setSceneSkyColor: (color: string) => void
  setSceneSunlightEnabled: (enabled: boolean) => void
  setSceneSunlightIntensity: (intensity: number) => void
  setSceneSunlightTimeOfDay: (timeOfDay: number) => void
  setSceneFogEnabled: (enabled: boolean) => void
  setSceneFogDistance: (distance: number) => void
  setSceneShowNameLabels: (showNameLabels: boolean) => void
  setSceneNameLabelTextColor: (color: string) => void
  setSceneNameLabelBackgroundColor: (color: string) => void
  setSceneNameLabelBackgroundOpacity: (opacity: number) => void
  setSceneNameLabelFollowObjectColor: (follow: boolean) => void
  setSceneNameLabelScale: (scale: number) => void
  setSceneNameLabelOffset: (offset: StageVec3) => void
  setSceneNameLabelShadowColor: (color: string) => void
  setSceneNameLabelShadowOpacity: (opacity: number) => void
  setSceneNameLabelShadowBlur: (blur: number) => void
  setSceneNameLabelShadowDistance: (distance: number) => void
  setSceneNameLabelShadowAngle: (angle: number) => void
  setSceneRenderStyle: (style: StageRenderStyle) => void
  /** 请求把视口平滑对准当前选中对象（无选中对象时不生效） */
  requestFocusSelected: () => void
}

/** 新场景默认工程名 */
export const CAMERA_STAGE_DEFAULT_PROJECT_NAME = '未命名场景'

/** 撤销历史跟踪场景数据切片（对象列表 + 动画轨道），界面态/播放态不入历史 */
type TrackedState = Pick<CameraStageState, 'objects' | 'animation' | 'stateKeyframes'>

/** 在暂停撤销跟踪的前提下把采样值落回对象（scrub/暂停/停止用，不污染历史与不自动打点） */
function applySampledObjectsSilently(time: number): void {
  const temporal = useCameraStageStore.temporal.getState()
  const wasTracking = temporal.isTracking
  if (wasTracking) temporal.pause()
  useCameraStageStore.setState((state) => ({
    objects: applyAnimationAtTime(state.objects, state.animation, time),
  }))
  if (wasTracking) temporal.resume()
}

/**
 * 会话式历史批处理：gizmo 拖拽、滑杆连续调整会触发大量 set，
 * 用会话把「一次连续交互」合并为一条撤销记录——会话内只记录首帧的前态，其余忽略。
 * 由交互组件在拖拽/聚焦开始时调用 begin、结束时调用 end。
 */
let historyRecord: StoreApi<CameraStageState>['setState'] | null = null
let historySessionActive = false
let historySessionCaptured = false
let historySessionPast: CameraStageState | null = null

export function beginHistorySession(): void {
  if (historySessionActive) return
  historySessionActive = true
  historySessionCaptured = false
  historySessionPast = null
}

export function endHistorySession(): void {
  if (historySessionActive && historySessionCaptured && historySessionPast && historyRecord) {
    historyRecord(historySessionPast)
  }
  historySessionActive = false
  historySessionCaptured = false
  historySessionPast = null
}

/** 生成同类对象的递增序号名，如"摄像机01"；按已用最大编号 +1，避免删除中间对象后再新增撞号 */
function nextName(objects: StageObject[], base: string): string {
  let maxN = 0
  for (const item of objects) {
    if (!item.name.startsWith(base)) continue
    const suffix = item.name.slice(base.length)
    if (/^\d+$/.test(suffix)) maxN = Math.max(maxN, Number(suffix))
  }
  return `${base}${String(maxN + 1).padStart(2, '0')}`
}

function firstCameraId(objects: StageObject[]): string | null {
  return getCameraObjects(objects)[0]?.id ?? null
}

const initialStateKeyframe = createStateKeyframe([], '关键帧 1')

export const useCameraStageStore = create<CameraStageState>()(
  temporal(
    (set) => ({
  objects: [],
  selectedId: null,
  gizmoMode: 'translate',
  viewMode: 'director',
  activeCameraId: null,
  currentProjectId: null,
  currentProjectName: CAMERA_STAGE_DEFAULT_PROJECT_NAME,
  animation: compileStateKeyframesToAnimation([initialStateKeyframe], []),
  playback: createDefaultPlayback(),
  sceneSettings: createDefaultSceneSettings(),
  stateKeyframes: [initialStateKeyframe],
  selectedStateKeyframeId: initialStateKeyframe.id,
  selectedStateKeyframeIds: [],
  focusToken: 0,

  addPrimitive: (kind) =>
    set((state) => {
      const object = createPrimitiveObject(
        kind,
        nextName(state.objects, PRIMITIVE_KIND_LABELS[kind]),
        pickDefaultColor(state.objects.length),
      )
      const objects = [...state.objects, object]
      const stateKeyframes = syncAddedObjectToStateKeyframes(state.stateKeyframes, object)
      return { objects, stateKeyframes, animation: compileStateKeyframesToAnimation(stateKeyframes, objects), selectedId: object.id }
    }),

  addCharacter: () =>
    set((state) => {
      const object = createCharacterObject(
        nextName(state.objects, '角色'),
        pickDefaultColor(state.objects.length),
      )
      const objects = [...state.objects, object]
      const stateKeyframes = syncAddedObjectToStateKeyframes(state.stateKeyframes, object)
      return { objects, stateKeyframes, animation: compileStateKeyframesToAnimation(stateKeyframes, objects), selectedId: object.id }
    }),

  addCamera: () =>
    set((state) => {
      const existingCameras = getCameraObjects(state.objects)
      const object = createCameraObject(
        nextName(state.objects, '摄像机'),
        pickDefaultColor(state.objects.length),
        getDirectorView() ?? undefined,
      )
      // 重要记录 007：已存在其他摄像机时，新摄像机画幅直接继承首摄像机当前值，
      // 不给用户可独立编辑的初始值（画幅一致性从创建时就保证，不依赖导出时再校验）。
      const finalObject = existingCameras[0]
        ? { ...object, aspectRatio: { ...existingCameras[0].aspectRatio } }
        : object
      // 新摄像机默认位置/朝向就是当前自由视角，添加后直接切到摄像机视角：
      // 一是让顶部视角按钮的高亮立刻和实际画面对上，二是隐藏所有摄像机图标（含它自己），
      // 避免因为新摄像机就摆在刚才的视点上，导致自由视角下看到自己的图标近距离怼脸
      const objects = [...state.objects, finalObject]
      const stateKeyframes = syncAddedObjectToStateKeyframes(state.stateKeyframes, finalObject)
      return {
        objects,
        stateKeyframes,
        animation: compileStateKeyframesToAnimation(stateKeyframes, objects),
        selectedId: finalObject.id,
        activeCameraId: finalObject.id,
        viewMode: 'camera',
      }
    }),

  duplicateObject: (id) =>
    set((state) => {
      const source = state.objects.find((item) => item.id === id)
      if (!source) return {}
      const clone = structuredClone(source)
      clone.id = uuidv4()
      clone.name = nextName(state.objects, source.name)
      const objects = [...state.objects, clone]
      const stateKeyframes = syncAddedObjectToStateKeyframes(state.stateKeyframes, clone)
      return {
        objects,
        stateKeyframes,
        animation: compileStateKeyframesToAnimation(stateKeyframes, objects),
        selectedId: clone.id,
        activeCameraId: clone.type === 'camera' ? clone.id : state.activeCameraId,
      }
    }),

  removeObject: (id) =>
    set((state) => {
      const objects = state.objects.filter((item) => item.id !== id)
      const activeCameraId = state.activeCameraId === id ? firstCameraId(objects) : state.activeCameraId
      const stateKeyframes = syncRemovedObjectFromStateKeyframes(state.stateKeyframes, id)
      return {
        objects,
        animation: compileStateKeyframesToAnimation(stateKeyframes, objects),
        stateKeyframes,
        selectedId: state.selectedId === id ? null : state.selectedId,
        activeCameraId,
        viewMode: state.viewMode === 'camera' && !activeCameraId ? 'director' : state.viewMode,
      }
    }),

  setSelected: (id) =>
    set((state) => ({
      selectedId: id,
      ...(isCameraId(state.objects, id) ? { activeCameraId: id } : {}),
    })),

  setGizmoMode: (mode) => set({ gizmoMode: mode }),

  setViewMode: (mode) =>
    set((state) => {
      if (mode === 'director') {
        return state.viewMode === mode ? state : { viewMode: mode }
      }
      const activeCameraId = isCameraId(state.objects, state.activeCameraId)
        ? state.activeCameraId
        : firstCameraId(state.objects)
      if (!activeCameraId) {
        return state.viewMode === 'director' && state.activeCameraId === null
          ? state
          : { viewMode: 'director', activeCameraId: null }
      }
      return state.viewMode === mode && state.activeCameraId === activeCameraId
        ? state
        : { viewMode: mode, activeCameraId }
    }),

  setActiveCameraId: (id) =>
    set((state) => {
      const activeCameraId = isCameraId(state.objects, id) ? id : null
      return {
        activeCameraId,
        viewMode: activeCameraId ? state.viewMode : 'director',
      }
    }),

  /**
    * 建模语义的对象写入：改动同步进**所有**状态关键帧，不产生意料之外的动画。
   *
    * 与 `updateObject` 的区别只在动画语义：那个是给人手动拖拽用的，把改动记录到当前时间点，
   * 关键帧（编辑动画）；这个是给助手和批量写入用的，表达"这个对象本来就该是这样"（建模）。
   * 两者共用同一套 applyObjectPatch 与重编译路径，不是两份实现。
   */
  updateObjectAcrossStateKeyframes: (id, patch) =>
    set((state) => {
      const objects = applyObjectPatch(state.objects, id, patch)
      const object = objects.find((item) => item.id === id)
      if (!object) return { objects }
      const stateKeyframes = syncAddedObjectToStateKeyframes(state.stateKeyframes, object)
      return { objects, stateKeyframes, animation: compileStateKeyframesToAnimation(stateKeyframes, objects) }
    }),

  updateObject: (id, patch) =>
    set((state) => {
      // aspectRatio 走 applyObjectPatch：非首摄像机的画幅补丁被钳制忽略，首摄像机改画幅
      // 联动同步其余摄像机（重要记录 007），其余字段行为与直接 map 一致
      const objects = applyObjectPatch(state.objects, id, patch)
      const object = objects.find((item) => item.id === id)
      if (!object) return { objects }
      if (object.type === 'camera' && 'lookAt' in patch && Object.keys(patch).length === 1) {
        return syncCameraLookAtAcrossStateKeyframes(state, objects, id, object.lookAt)
      }
      return compileStateKeyframeEdit(state, objects, [id])
    }),

  prepareStateKeyframeEdit: (id) =>
    set((state) => {
      if (state.playback.playing) return {}
      return compileStateKeyframeEdit(state, state.objects, [id])
    }),

  updateTransform: (id, patch, _changedPaths) =>
    set((state) => {
      const objects = state.objects.map((item) =>
        item.id === id ? { ...item, transform: { ...item.transform, ...patch } } : item,
      )
      const object = objects.find((item) => item.id === id)
      if (!object) return { objects }
      return compileStateKeyframeEdit(state, objects, [id])
    }),

  updateCameraView: (id, patch) =>
    set((state) => {
      const objects = state.objects.map((item) => {
        if (item.id !== id || item.type !== 'camera') return item
        return {
          ...item,
          transform: {
            ...item.transform,
            ...(patch.position ? { position: patch.position } : {}),
            ...(patch.rotation ? { rotation: patch.rotation } : {}),
          },
          ...(patch.lookAtTarget
            ? { lookAt: { mode: 'manual' as const, target: patch.lookAtTarget } }
            : {}),
        }
      })
      const object = objects.find((item) => item.id === id)
      if (!object || object.type !== 'camera') return { objects }
      const edit = patch.position || patch.rotation
        ? compileStateKeyframeEdit(state, objects, [id])
        : { objects }
      if (!patch.lookAtTarget) return edit
      const intermediateState: CameraStageState = { ...state, ...edit, objects }
      return {
        ...edit,
        ...syncCameraLookAtAcrossStateKeyframes(intermediateState, objects, id, object.lookAt),
      }
    }),

  updatePoseJoint: (id, jointId, euler, _changedPaths) =>
    set((state) => {
      const objects = state.objects.map((item) =>
        item.id === id && item.type === 'character'
          ? {
            ...item,
            pose: { ...item.pose, joints: { ...item.pose.joints, [jointId]: euler } },
            motion: createPoseMotion(),
          }
          : item,
      )
      const object = objects.find((item) => item.id === id)
      if (!object) return { objects }
      return compileStateKeyframeEdit(state, objects, [id])
    }),

  applyPosePreset: (id, preset) =>
    set((state) => {
      const objects = state.objects.map((item) =>
        item.id === id && item.type === 'character'
          ? { ...item, pose: clonePose(preset), motion: createPoseMotion() }
          : item,
      )
      const object = objects.find((item) => item.id === id)
      if (!object || object.type !== 'character') return { objects }
      return compileStateKeyframeEdit(state, objects, [id])
    }),

  bindProject: (id, name) => set({ currentProjectId: id, currentProjectName: name }),

  newScene: (name) => {
    // 新工程不继承上一次离开时的自由视角（跨工程共享的 localStorage 快照），回到标准正视角度
    resetDirectorView()
    set(() => {
      // 新工程默认自带一台摄像机并直接进入摄像机视角，打开即有可拍画面
      const camera = createCameraObject(nextName([], '摄像机'), pickDefaultColor(0))
      const objects = [camera]
      const stateKeyframes = [createStateKeyframe(objects, '关键帧 1', camera.id)]
      return {
      objects,
      selectedId: camera.id,
      gizmoMode: 'translate',
      viewMode: 'camera',
      activeCameraId: camera.id,
      currentProjectId: null,
      currentProjectName: name,
      animation: compileStateKeyframesToAnimation(stateKeyframes, objects),
      playback: createDefaultPlayback(),
      sceneSettings: createDefaultSceneSettings(),
      stateKeyframes,
      selectedStateKeyframeId: stateKeyframes[0].id,
      selectedStateKeyframeIds: [],
      focusToken: 0,
      }
    })
  },

  loadSnapshot: (snapshot, project) =>
    set(() => {
      const activeCameraId = isCameraId(snapshot.objects, snapshot.activeCameraId)
        ? snapshot.activeCameraId
        : firstCameraId(snapshot.objects)
      const animation = compileStateKeyframesToAnimation(snapshot.stateKeyframes, snapshot.objects)
      return {
        // 播放头加载后固定从 0 开始，因此场景对象也必须立即落到 t=0 的权威采样值。
        // 否则首屏会短暂展示持久化时的对象值，直到播放驱动首帧采样才跳到首关键帧。
        objects: applyAnimationAtTime(snapshot.objects, animation, 0),
        selectedId: null,
        gizmoMode: 'translate',
        viewMode: 'director',
        activeCameraId,
        currentProjectId: project.id,
        currentProjectName: project.name,
        animation,
        playback: createDefaultPlayback(),
        sceneSettings: snapshot.sceneSettings ?? createDefaultSceneSettings(),
        stateKeyframes: snapshot.stateKeyframes,
        selectedStateKeyframeId: snapshot.stateKeyframes[0]?.id ?? null,
        selectedStateKeyframeIds: [],
        focusToken: 0,
      }
    }),

  ...createStateKeyframeSlice(set),

  play: () =>
    set((state) => {
      const canPlay = state.stateKeyframes.length > 0 && state.animation.duration > 0
      if (!canPlay) return {}
      // 播放到末尾后再按播放，从头开始
      const atEnd = state.playback.currentTime >= state.animation.duration
      return {
        playback: { ...state.playback, playing: true, currentTime: atEnd ? 0 : state.playback.currentTime },
      }
    }),

  pause: () => {
    // 播放中按连续时间采样以保持丝滑；停下时吸附到最近帧，让后续编辑永远落在帧格上。
    const state = useCameraStageStore.getState()
    const snapped = quantizeToFrame(state.playback.currentTime, state.animation.fps)
    applySampledObjectsSilently(snapped)
    set((current) => ({ playback: { ...current.playback, playing: false, currentTime: snapped } }))
  },

  stop: () => {
    applySampledObjectsSilently(0)
    set((state) => ({ playback: { ...state.playback, playing: false, currentTime: 0 } }))
  },

  seek: (time) => {
    const state = useCameraStageStore.getState()
    const snapped = quantizeToFrame(time, state.animation.fps)
    // 允许把播放头放到最后关键帧之后，以便在未来时间直接添加状态关键帧。
    const clamped = Math.max(0, snapped)
    if (!state.playback.playing) applySampledObjectsSilently(clamped)
    set((current) => ({ playback: { ...current.playback, currentTime: clamped } }))
  },

  setPlaybackTime: (time) =>
    set((state) => ({ playback: { ...state.playback, currentTime: time } })),

  toggleLoop: () => set((state) => ({ playback: { ...state.playback, loop: !state.playback.loop } })),

  setSceneGroundColor: (color) =>
    set((state) => ({
      sceneSettings: { ...state.sceneSettings, ground: { ...state.sceneSettings.ground, color } },
    })),

  setSceneGroundPattern: (pattern) =>
    set((state) => ({
      sceneSettings: { ...state.sceneSettings, ground: { ...state.sceneSettings.ground, pattern } },
    })),

  setSceneGroundDensity: (density) =>
    set((state) => ({
      sceneSettings: {
        ...state.sceneSettings,
        ground: { ...state.sceneSettings.ground, density: Math.max(1, Math.min(64, density)) },
      },
    })),

  setSceneGroundGridLineColor: (color) =>
    set((state) => ({
      sceneSettings: {
        ...state.sceneSettings,
        ground: { ...state.sceneSettings.ground, gridLineColor: color },
      },
    })),

  setSceneGroundGridLineThickness: (thickness) =>
    set((state) => ({
      sceneSettings: {
        ...state.sceneSettings,
        ground: {
          ...state.sceneSettings.ground,
          gridLineThickness: Math.max(0.2, Math.min(3, thickness)),
        },
      },
    })),

  setSceneGroundCheckerLightColor: (color) =>
    set((state) => ({
      sceneSettings: {
        ...state.sceneSettings,
        ground: { ...state.sceneSettings.ground, checkerLightColor: color },
      },
    })),

  setSceneGroundCheckerDarkColor: (color) =>
    set((state) => ({
      sceneSettings: {
        ...state.sceneSettings,
        ground: { ...state.sceneSettings.ground, checkerDarkColor: color },
      },
    })),

  setSceneSkyColor: (color) =>
    set((state) => ({
      sceneSettings: { ...state.sceneSettings, sky: { color } },
    })),

  setSceneSunlightEnabled: (enabled) =>
    set((state) => ({
      sceneSettings: { ...state.sceneSettings, sunlight: { ...state.sceneSettings.sunlight, enabled } },
    })),

  setSceneSunlightIntensity: (intensity) =>
    set((state) => ({
      sceneSettings: {
        ...state.sceneSettings,
        sunlight: { ...state.sceneSettings.sunlight, intensity: Math.max(0, Math.min(3, intensity)) },
      },
    })),

  setSceneSunlightTimeOfDay: (timeOfDay) =>
    set((state) => ({
      sceneSettings: {
        ...state.sceneSettings,
        sunlight: { ...state.sceneSettings.sunlight, timeOfDay: Math.max(0, Math.min(24, timeOfDay)) },
      },
    })),

  setSceneFogEnabled: (enabled) =>
    set((state) => ({
      sceneSettings: {
        ...state.sceneSettings,
        fog: { ...state.sceneSettings.fog, enabled },
      },
    })),

  setSceneFogDistance: (distance) =>
    set((state) => ({
      sceneSettings: {
        ...state.sceneSettings,
        fog: { ...state.sceneSettings.fog, distance: Math.max(30, Math.min(200, distance)) },
      },
    })),

  setSceneShowNameLabels: (showNameLabels) =>
    set((state) => ({
      sceneSettings: {
        ...state.sceneSettings,
        display: { ...state.sceneSettings.display, showNameLabels },
      },
    })),

  setSceneNameLabelTextColor: (color) =>
    set((state) => ({
      sceneSettings: {
        ...state.sceneSettings,
        display: {
          ...state.sceneSettings.display,
          nameLabel: { ...state.sceneSettings.display.nameLabel, textColor: color },
        },
      },
    })),

  setSceneNameLabelBackgroundColor: (color) =>
    set((state) => ({
      sceneSettings: {
        ...state.sceneSettings,
        display: {
          ...state.sceneSettings.display,
          nameLabel: { ...state.sceneSettings.display.nameLabel, backgroundColor: color },
        },
      },
    })),

  setSceneNameLabelBackgroundOpacity: (opacity) =>
    set((state) => ({
      sceneSettings: {
        ...state.sceneSettings,
        display: {
          ...state.sceneSettings.display,
          nameLabel: {
            ...state.sceneSettings.display.nameLabel,
            backgroundOpacity: Math.max(0, Math.min(1, opacity)),
          },
        },
      },
    })),

  setSceneNameLabelFollowObjectColor: (follow) =>
    set((state) => ({
      sceneSettings: {
        ...state.sceneSettings,
        display: {
          ...state.sceneSettings.display,
          nameLabel: { ...state.sceneSettings.display.nameLabel, followObjectColor: follow },
        },
      },
    })),

  setSceneNameLabelScale: (scale) =>
    set((state) => ({
      sceneSettings: {
        ...state.sceneSettings,
        display: {
          ...state.sceneSettings.display,
          nameLabel: {
            ...state.sceneSettings.display.nameLabel,
            scale: Math.max(0.5, Math.min(2.5, scale)),
          },
        },
      },
    })),

  setSceneNameLabelOffset: (offset) =>
    set((state) => ({
      sceneSettings: {
        ...state.sceneSettings,
        display: {
          ...state.sceneSettings.display,
          nameLabel: {
            ...state.sceneSettings.display.nameLabel,
            offset: {
              x: Math.max(-3, Math.min(3, offset.x)),
              y: Math.max(-3, Math.min(3, offset.y)),
              z: Math.max(-3, Math.min(3, offset.z)),
            },
          },
        },
      },
    })),

  setSceneNameLabelShadowColor: (color) =>
    set((state) => ({
      sceneSettings: {
        ...state.sceneSettings,
        display: {
          ...state.sceneSettings.display,
          nameLabel: { ...state.sceneSettings.display.nameLabel, shadowColor: color },
        },
      },
    })),

  setSceneNameLabelShadowOpacity: (opacity) =>
    set((state) => ({
      sceneSettings: {
        ...state.sceneSettings,
        display: {
          ...state.sceneSettings.display,
          nameLabel: {
            ...state.sceneSettings.display.nameLabel,
            shadowOpacity: Math.max(0, Math.min(1, opacity)),
          },
        },
      },
    })),

  setSceneNameLabelShadowBlur: (blur) =>
    set((state) => ({
      sceneSettings: {
        ...state.sceneSettings,
        display: {
          ...state.sceneSettings.display,
          nameLabel: {
            ...state.sceneSettings.display.nameLabel,
            shadowBlur: Math.max(0, Math.min(24, blur)),
          },
        },
      },
    })),

  setSceneNameLabelShadowDistance: (distance) =>
    set((state) => ({
      sceneSettings: {
        ...state.sceneSettings,
        display: {
          ...state.sceneSettings.display,
          nameLabel: {
            ...state.sceneSettings.display.nameLabel,
            shadowDistance: Math.max(0, Math.min(24, distance)),
          },
        },
      },
    })),

  setSceneNameLabelShadowAngle: (angle) =>
    set((state) => ({
      sceneSettings: {
        ...state.sceneSettings,
        display: {
          ...state.sceneSettings.display,
          nameLabel: {
            ...state.sceneSettings.display.nameLabel,
            shadowAngle: ((angle % 360) + 360) % 360,
          },
        },
      },
    })),

  setSceneRenderStyle: (style) =>
    set((state) => ({
      sceneSettings: {
        ...state.sceneSettings,
        render: { ...state.sceneSettings.render, style },
      },
    })),

  requestFocusSelected: () => set((state) => ({ focusToken: state.focusToken + 1 })),
    }),
    {
      limit: 100,
      // 跟踪场景数据 + 动画轨道切片；界面态/播放态变更不入历史
      partialize: (state): TrackedState => ({
        objects: state.objects,
        animation: state.animation,
        stateKeyframes: state.stateKeyframes,
      }),
      // 对象数组与动画对象都走不可变更新，引用相等即无实质变化 → 跳过记录
      equality: (a, b) =>
        a.objects === b.objects &&
        a.animation === b.animation &&
        a.stateKeyframes === b.stateKeyframes,
      handleSet: (handleSet) => {
        historyRecord = handleSet
        return (pastState) => {
          if (historySessionActive) {
            if (!historySessionCaptured) {
              historySessionPast = pastState as CameraStageState
              historySessionCaptured = true
            }
            return
          }
          handleSet(pastState)
        }
      },
    },
  ),
)

/** 清空撤销/重做历史（加载工程、新建场景后调用，避免跨工程回退） */
export function clearCameraStageHistory(): void {
  useCameraStageStore.temporal.getState().clear()
}
