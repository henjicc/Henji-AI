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
import { getDirectorView } from '../scene/directorViewState'
import { clonePose } from '../domain/poseTypes'
import type { StagePoseJointId, StagePosePreset } from '../domain/poseTypes'
import type { StageSceneSnapshotInput } from '../domain/sceneSerialization'
import { createShot, type StageEditorMode, type StageShot } from '../domain/shotTypes'
import { compileShotsToAnimation } from '../domain/shotCompiler'
import {
  createDefaultAnimation,
  createDefaultPlayback,
  type StageEasing,
  type StagePlaybackState,
  type StageSceneAnimation,
} from '../domain/animationTypes'
import { getAnimatablePropByPath, poseJointPath } from '../domain/animatableProps'
import { getTrack, removeObjectTracks, upsertTrackKeyframe } from './animationActions'
import { createKeyframeSlice } from './keyframeSlice'
import {
  compileSimpleEdit,
  createShotSlice,
  syncAddedObjectToShots,
  syncRemovedObjectFromShots,
  type ShotTimingPatch,
  type ShotTransitionPatch,
} from './shotSlice'
import { applyAnimationAtTime } from './playbackSampling'
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

export interface CameraStageState {
  objects: StageObject[]
  selectedId: string | null
  gizmoMode: StageGizmoMode
  viewMode: StageViewMode
  activeCameraId: string | null
  /** 当前已保存工程 id；null 表示尚未保存过（新场景） */
  currentProjectId: string | null
  /** 当前工程名（新场景用默认名，保存后与工程记录一致） */
  currentProjectName: string
  /** 关键帧动画数据（轨道 + 时长 + 帧率），进撤销历史、随工程持久化 */
  animation: StageSceneAnimation
  /** 播放界面态（不进撤销历史、不持久化） */
  playback: StagePlaybackState
  /** 时间轴当前选中的关键帧集合（objectId::path::time 键），界面态 */
  selectedKeyframes: string[]
  /** 场景级设置（背景色/网格显隐），随工程持久化，不进撤销历史 */
  sceneSettings: StageSceneSettings
  /** 编辑器模式（simple=镜头卡模式，pro=现有关键帧模式），随工程持久化；本任务仅接线字段与默认值，动作在 2.1 实现 */
  editorMode: StageEditorMode
  /** 镜头卡列表，随工程持久化；本任务仅接线字段与默认值，动作在 2.1 实现 */
  shots: StageShot[]
  selectedShotId: string | null
  /** 非关键帧时间编辑场景时，是否自动插入状态关键帧。 */
  simpleAutoKeyframe: boolean
  /** 聚焦选中对象请求令牌：每次递增触发一次视口平滑对准，界面态 */
  focusToken: number
  addShot: () => void
  moveShotTime: (id: string, time: number) => void
  removeShot: (id: string) => void
  reorderShot: (id: string, toIndex: number) => void
  selectShot: (id: string) => void
  /** 只更新 selectedShotId，不应用快照/不移动播放头（界面态，不进撤销历史）；scrub 跟随选中用 */
  setSelectedShotIdOnly: (id: string) => void
  updateShotTiming: (id: string, patch: ShotTimingPatch) => void
  updateShotName: (id: string, name: string) => void
  updateShotTransition: (id: string, patch: ShotTransitionPatch) => void
  /** 修改镜头卡拍摄机位（重要记录 005）；null = 取消指定，沿用全局 activeCameraId */
  updateShotCamera: (id: string, cameraId: string | null) => void
  updateShotContinuity: (id: string, continuity: StageShot['continuity']) => void
  setSimpleAutoKeyframe: (enabled: boolean) => void
  captureIntoSelectedShot: (objectIds?: string[]) => void
  setEditorMode: (mode: StageEditorMode) => void
  /** 将简易镜头卡单向固化为专业关键帧工程；专业工程调用时无操作。 */
  bakeToProMode: () => void
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
  updateTransform: (id: string, patch: Partial<StageTransform>, autoKeyPaths?: string[]) => void
  /** 更新角色单个关节的欧拉偏移（角度制） */
  updatePoseJoint: (id: string, jointId: StagePoseJointId, euler: StageVec3, autoKeyPaths?: string[]) => void
  /** 一键应用预设姿势（整体替换当前姿态） */
  applyPosePreset: (id: string, preset: StagePosePreset) => void
  /** 关联到某个已保存工程（保存/加载后调用），仅更新工程标识不动场景数据 */
  bindProject: (id: string, name: string) => void
  /** 重置为空白新场景（新建工程用）：清空对象与工程标识，复位界面态 */
  newScene: (name: string) => void
  /** 用工程快照整体重置场景（加载工程用）；同时复位选中/视角等界面态 */
  loadSnapshot: (snapshot: StageSceneSnapshotInput, project: { id: string; name: string }) => void

  /* ---- 关键帧动画动作（tracked：进撤销历史） ---- */
  /** 分组码表：整组（vec3 的 X/Y/Z 或单值）在当前时间统一打/删点（属性面板/时间轴父行用） */
  toggleKeyframeGroup: (objectId: string, groupPath: string) => void
  /** 单条 scalar/color 轨道码表三态切换（时间轴分量子行用） */
  toggleKeyframe: (objectId: string, path: string) => void
  /** 在当前时间以对象当前值强制打点（属性行改值自动打点用） */
  keyframeAtCurrentTime: (objectId: string, path: string) => void
  removeKeyframe: (objectId: string, path: string, time: number) => void
  moveKeyframe: (objectId: string, path: string, fromTime: number, toTime: number) => void
  /** 改某关键帧的值（曲线图里竖向拖点用） */
  setKeyframeValue: (objectId: string, path: string, time: number, value: number) => void
  /** 批量设置若干关键帧的缓动（速度曲线编辑器用） */
  setKeyframesEasing: (
    targets: Array<{ objectId: string; path: string; time: number }>,
    easing: StageEasing,
  ) => void
  clearTrack: (objectId: string, path: string) => void
  setDuration: (duration: number) => void
  setFps: (fps: number) => void

  /* ---- 播放/时间轴界面态动作（非 tracked） ---- */
  play: () => void
  pause: () => void
  stop: () => void
  /** 定位播放头：非播放态下同时把采样值落回对象（scrub），播放态仅移动播放头 */
  seek: (time: number) => void
  /** 播放驱动低频回写播放头（不落对象、不进历史） */
  setPlaybackTime: (time: number) => void
  toggleLoop: () => void
  setSelectedKeyframes: (keys: string[]) => void

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
  /** 请求把视口平滑对准当前选中对象（无选中对象时不生效） */
  requestFocusSelected: () => void
}

/** 时间轴关键帧唯一键（选中集合、拖拽标识用） */
export function keyframeKey(objectId: string, path: string, time: number): string {
  return `${objectId}::${path}::${time.toFixed(4)}`
}

/** 解析关键帧唯一键（objectId / path 均不含 '::'，故可安全按分隔符还原） */
export function parseKeyframeKey(
  key: string,
): { objectId: string; path: string; time: number } | null {
  const parts = key.split('::')
  if (parts.length !== 3) return null
  const time = Number(parts[2])
  if (!Number.isFinite(time)) return null
  return { objectId: parts[0], path: parts[1], time }
}

/** 新场景默认工程名 */
export const CAMERA_STAGE_DEFAULT_PROJECT_NAME = '未命名场景'

/** 撤销历史跟踪场景数据切片（对象列表 + 动画轨道），界面态/播放态不入历史 */
type TrackedState = Pick<CameraStageState, 'objects' | 'animation' | 'shots' | 'editorMode'>

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

/** AE 式自动打点：对存在轨道的路径，在给定时间以对象当前值 upsert 关键帧 */
function autoKeyPaths(
  animation: StageSceneAnimation,
  object: StageObject,
  paths: string[],
  time: number,
): StageSceneAnimation {
  let next = animation
  for (const path of paths) {
    if (!getTrack(next, object.id, path)) continue
    const descriptor = getAnimatablePropByPath(path)
    if (!descriptor) continue
    next = upsertTrackKeyframe(next, object.id, path, time, descriptor.getValue(object))
  }
  return next
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

const initialShot = createShot([], '关键帧 1')

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
  animation: compileShotsToAnimation([initialShot], []),
  playback: createDefaultPlayback(),
  selectedKeyframes: [],
  sceneSettings: createDefaultSceneSettings(),
  editorMode: 'simple',
  shots: [initialShot],
  selectedShotId: initialShot.id,
  simpleAutoKeyframe: false,
  focusToken: 0,

  addPrimitive: (kind) =>
    set((state) => {
      const object = createPrimitiveObject(
        kind,
        nextName(state.objects, PRIMITIVE_KIND_LABELS[kind]),
        pickDefaultColor(state.objects.length),
      )
      const objects = [...state.objects, object]
      if (state.editorMode !== 'simple') return { objects, selectedId: object.id }
      const shots = syncAddedObjectToShots(state.shots, object)
      return { objects, shots, animation: compileShotsToAnimation(shots, objects), selectedId: object.id }
    }),

  addCharacter: () =>
    set((state) => {
      const object = createCharacterObject(
        nextName(state.objects, '角色'),
        pickDefaultColor(state.objects.length),
      )
      const objects = [...state.objects, object]
      if (state.editorMode !== 'simple') return { objects, selectedId: object.id }
      const shots = syncAddedObjectToShots(state.shots, object)
      return { objects, shots, animation: compileShotsToAnimation(shots, objects), selectedId: object.id }
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
      const shots = state.editorMode === 'simple' ? syncAddedObjectToShots(state.shots, finalObject) : state.shots
      return {
        objects,
        ...(state.editorMode === 'simple' ? { shots, animation: compileShotsToAnimation(shots, objects) } : {}),
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
      const shots = state.editorMode === 'simple' ? syncAddedObjectToShots(state.shots, clone) : state.shots
      return {
        objects,
        ...(state.editorMode === 'simple' ? { shots, animation: compileShotsToAnimation(shots, objects) } : {}),
        selectedId: clone.id,
        activeCameraId: clone.type === 'camera' ? clone.id : state.activeCameraId,
      }
    }),

  removeObject: (id) =>
    set((state) => {
      const objects = state.objects.filter((item) => item.id !== id)
      const activeCameraId = state.activeCameraId === id ? firstCameraId(objects) : state.activeCameraId
      const shots = state.editorMode === 'simple' ? syncRemovedObjectFromShots(state.shots, id) : state.shots
      return {
        objects,
        animation: state.editorMode === 'simple'
          ? compileShotsToAnimation(shots, objects)
          : removeObjectTracks(state.animation, id),
        ...(state.editorMode === 'simple' ? { shots } : {}),
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
        return { viewMode: mode }
      }
      const activeCameraId = isCameraId(state.objects, state.activeCameraId)
        ? state.activeCameraId
        : firstCameraId(state.objects)
      return activeCameraId ? { viewMode: mode, activeCameraId } : { viewMode: 'director', activeCameraId: null }
    }),

  setActiveCameraId: (id) =>
    set((state) => {
      const activeCameraId = isCameraId(state.objects, id) ? id : null
      return {
        activeCameraId,
        viewMode: activeCameraId ? state.viewMode : 'director',
      }
    }),

  updateObject: (id, patch) =>
    set((state) => {
      // aspectRatio 走 applyObjectPatch：非首摄像机的画幅补丁被钳制忽略，首摄像机改画幅
      // 联动同步其余摄像机（重要记录 007），其余字段行为与直接 map 一致
      const objects = applyObjectPatch(state.objects, id, patch)
      const object = objects.find((item) => item.id === id)
      if (!object) return { objects }
      if (state.editorMode === 'simple') return compileSimpleEdit(state, objects, [id])
      // color / fov 是可动画标量/颜色属性，有轨道时自动打点
      const paths: string[] = []
      if ('color' in patch) paths.push('color')
      if ('fov' in patch) paths.push('fov')
      const animation = autoKeyPaths(state.animation, object, paths, state.playback.currentTime)
      return animation === state.animation ? { objects } : { objects, animation }
    }),

  updateTransform: (id, patch, explicitAutoKeyPaths) =>
    set((state) => {
      const objects = state.objects.map((item) =>
        item.id === id ? { ...item, transform: { ...item.transform, ...patch } } : item,
      )
      const object = objects.find((item) => item.id === id)
      if (!object) return { objects }
      if (state.editorMode === 'simple') return compileSimpleEdit(state, objects, [id])
      // 分量化：每个变更的变换属性展开为 X/Y/Z 三条分量路径分别自动打点
      const paths = explicitAutoKeyPaths ?? Object.keys(patch).flatMap((key) =>
        ['x', 'y', 'z'].map((axis) => `transform.${key}.${axis}`),
      )
      const animation = autoKeyPaths(state.animation, object, paths, state.playback.currentTime)
      return animation === state.animation ? { objects } : { objects, animation }
    }),

  updatePoseJoint: (id, jointId, euler, explicitAutoKeyPaths) =>
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
      if (state.editorMode === 'simple') return compileSimpleEdit(state, objects, [id])
      const base = poseJointPath(jointId)
      const paths = explicitAutoKeyPaths ?? ['x', 'y', 'z'].map((axis) => `${base}.${axis}`)
      const animation = autoKeyPaths(state.animation, object, paths, state.playback.currentTime)
      return animation === state.animation ? { objects } : { objects, animation }
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
      if (state.editorMode === 'simple') return compileSimpleEdit(state, objects, [id])
      // 预设整体替换姿态：对所有已有关节轨道自动打点
      const paths = state.animation.tracks
        .filter((track) => track.objectId === id && track.propertyPath.startsWith('pose.joints.'))
        .map((track) => track.propertyPath)
      const animation = autoKeyPaths(state.animation, object, paths, state.playback.currentTime)
      return animation === state.animation ? { objects } : { objects, animation }
    }),

  bindProject: (id, name) => set({ currentProjectId: id, currentProjectName: name }),

  newScene: (name) =>
    set(() => {
      const shots = [createShot([], '关键帧 1')]
      return {
      objects: [],
      selectedId: null,
      gizmoMode: 'translate',
      viewMode: 'director',
      activeCameraId: null,
      currentProjectId: null,
      currentProjectName: name,
      animation: compileShotsToAnimation(shots, []),
      playback: createDefaultPlayback(),
      selectedKeyframes: [],
      sceneSettings: createDefaultSceneSettings(),
      editorMode: 'simple',
      shots,
      selectedShotId: shots[0].id,
      simpleAutoKeyframe: false,
      focusToken: 0,
      }
    }),

  loadSnapshot: (snapshot, project) =>
    set(() => {
      const activeCameraId = isCameraId(snapshot.objects, snapshot.activeCameraId)
        ? snapshot.activeCameraId
        : firstCameraId(snapshot.objects)
      return {
        objects: snapshot.objects,
        selectedId: null,
        gizmoMode: 'translate',
        viewMode: 'director',
        activeCameraId,
        currentProjectId: project.id,
        currentProjectName: project.name,
        animation: snapshot.animation ?? createDefaultAnimation(),
        playback: createDefaultPlayback(),
        selectedKeyframes: [],
        sceneSettings: snapshot.sceneSettings ?? createDefaultSceneSettings(),
        editorMode: snapshot.editorMode ?? 'pro',
        shots: snapshot.shots ?? [],
        selectedShotId: snapshot.shots?.[0]?.id ?? null,
        simpleAutoKeyframe: false,
        focusToken: 0,
      }
    }),

  ...createKeyframeSlice(set),
  ...createShotSlice(set),

  play: () =>
    set((state) => {
      const canPlay = state.editorMode === 'simple'
        ? state.shots.length > 0 && state.animation.duration > 0
        : state.animation.tracks.length > 0
      if (!canPlay) return {}
      // 播放到末尾后再按播放，从头开始
      const atEnd = state.playback.currentTime >= state.animation.duration
      return {
        playback: { ...state.playback, playing: true, currentTime: atEnd ? 0 : state.playback.currentTime },
      }
    }),

  pause: () => {
    // 先按当前播放头把采样值落回对象（另一次 set，避免嵌套 setState），再置暂停
    applySampledObjectsSilently(useCameraStageStore.getState().playback.currentTime)
    set((state) => ({ playback: { ...state.playback, playing: false } }))
  },

  stop: () => {
    applySampledObjectsSilently(0)
    set((state) => ({ playback: { ...state.playback, playing: false, currentTime: 0 } }))
  },

  seek: (time) => {
    const state = useCameraStageStore.getState()
    // 简易模式允许把播放头放到最后关键帧之后，以便在未来时间直接添加关键帧。
    const clamped = state.editorMode === 'simple'
      ? Math.max(0, time)
      : Math.max(0, Math.min(state.animation.duration, time))
    if (!state.playback.playing) applySampledObjectsSilently(clamped)
    set((current) => ({ playback: { ...current.playback, currentTime: clamped } }))
  },

  setPlaybackTime: (time) =>
    set((state) => ({ playback: { ...state.playback, currentTime: time } })),

  toggleLoop: () => set((state) => ({ playback: { ...state.playback, loop: !state.playback.loop } })),

  setSelectedKeyframes: (keys) => set({ selectedKeyframes: keys }),

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

  requestFocusSelected: () => set((state) => ({ focusToken: state.focusToken + 1 })),
    }),
    {
      limit: 100,
      // 跟踪场景数据 + 动画轨道切片；界面态/播放态变更不入历史
      partialize: (state): TrackedState => ({
        objects: state.objects,
        animation: state.animation,
        shots: state.shots,
        editorMode: state.editorMode,
      }),
      // 对象数组与动画对象都走不可变更新，引用相等即无实质变化 → 跳过记录
      equality: (a, b) =>
        a.objects === b.objects &&
        a.animation === b.animation &&
        a.shots === b.shots &&
        a.editorMode === b.editorMode,
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
