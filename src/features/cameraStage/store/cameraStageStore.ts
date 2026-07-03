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
import { getCameraObjects } from '../domain/cameraUtils'
import { clonePose } from '../domain/poseTypes'
import type { StagePoseJointId, StagePosePreset } from '../domain/poseTypes'
import type { StageSceneSnapshotInput } from '../domain/sceneSerialization'
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
  /** 聚焦选中对象请求令牌：每次递增触发一次视口平滑对准，界面态 */
  focusToken: number
  addPrimitive: (kind: StagePrimitiveKind) => void
  addCharacter: () => void
  addCamera: () => void
  /** 深拷贝复制对象（含角色姿态/机位设置），名称自动递增，复制后自动选中 */
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
  setSceneBackgroundColor: (color: string) => void
  setSceneGridVisible: (visible: boolean) => void
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
type TrackedState = Pick<CameraStageState, 'objects' | 'animation'>

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

/** 生成同类对象的递增序号名，如"立方体 2" */
function nextName(objects: StageObject[], base: string): string {
  const count = objects.filter((item) => item.name.startsWith(base)).length
  return count === 0 ? base : `${base} ${count + 1}`
}

function firstCameraId(objects: StageObject[]): string | null {
  return getCameraObjects(objects)[0]?.id ?? null
}

function isCameraId(objects: StageObject[], id: string | null): boolean {
  return !!id && objects.some((item) => item.id === id && item.type === 'camera')
}

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
  animation: createDefaultAnimation(),
  playback: createDefaultPlayback(),
  selectedKeyframes: [],
  sceneSettings: createDefaultSceneSettings(),
  focusToken: 0,

  addPrimitive: (kind) =>
    set((state) => {
      const object = createPrimitiveObject(
        kind,
        nextName(state.objects, PRIMITIVE_KIND_LABELS[kind]),
        pickDefaultColor(state.objects.length),
      )
      return { objects: [...state.objects, object], selectedId: object.id }
    }),

  addCharacter: () =>
    set((state) => {
      const object = createCharacterObject(
        nextName(state.objects, '角色'),
        pickDefaultColor(state.objects.length),
      )
      return { objects: [...state.objects, object], selectedId: object.id }
    }),

  addCamera: () =>
    set((state) => {
      const object = createCameraObject(
        nextName(state.objects, '机位'),
        pickDefaultColor(state.objects.length),
      )
      return { objects: [...state.objects, object], selectedId: object.id, activeCameraId: object.id }
    }),

  duplicateObject: (id) =>
    set((state) => {
      const source = state.objects.find((item) => item.id === id)
      if (!source) return {}
      const clone = structuredClone(source)
      clone.id = uuidv4()
      clone.name = nextName(state.objects, source.name)
      return {
        objects: [...state.objects, clone],
        selectedId: clone.id,
        activeCameraId: clone.type === 'camera' ? clone.id : state.activeCameraId,
      }
    }),

  removeObject: (id) =>
    set((state) => {
      const objects = state.objects.filter((item) => item.id !== id)
      const activeCameraId = state.activeCameraId === id ? firstCameraId(objects) : state.activeCameraId
      return {
        objects,
        animation: removeObjectTracks(state.animation, id),
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
      const objects = state.objects.map((item) =>
        item.id === id ? ({ ...item, ...patch } as StageObject) : item,
      )
      const object = objects.find((item) => item.id === id)
      if (!object) return { objects }
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
          ? { ...item, pose: { ...item.pose, joints: { ...item.pose.joints, [jointId]: euler } } }
          : item,
      )
      const object = objects.find((item) => item.id === id)
      if (!object) return { objects }
      const base = poseJointPath(jointId)
      const paths = explicitAutoKeyPaths ?? ['x', 'y', 'z'].map((axis) => `${base}.${axis}`)
      const animation = autoKeyPaths(state.animation, object, paths, state.playback.currentTime)
      return animation === state.animation ? { objects } : { objects, animation }
    }),

  applyPosePreset: (id, preset) =>
    set((state) => {
      const objects = state.objects.map((item) =>
        item.id === id && item.type === 'character' ? { ...item, pose: clonePose(preset) } : item,
      )
      const object = objects.find((item) => item.id === id)
      if (!object || object.type !== 'character') return { objects }
      // 预设整体替换姿态：对所有已有关节轨道自动打点
      const paths = state.animation.tracks
        .filter((track) => track.objectId === id && track.propertyPath.startsWith('pose.joints.'))
        .map((track) => track.propertyPath)
      const animation = autoKeyPaths(state.animation, object, paths, state.playback.currentTime)
      return animation === state.animation ? { objects } : { objects, animation }
    }),

  bindProject: (id, name) => set({ currentProjectId: id, currentProjectName: name }),

  newScene: (name) =>
    set({
      objects: [],
      selectedId: null,
      gizmoMode: 'translate',
      viewMode: 'director',
      activeCameraId: null,
      currentProjectId: null,
      currentProjectName: name,
      animation: createDefaultAnimation(),
      playback: createDefaultPlayback(),
      selectedKeyframes: [],
      sceneSettings: createDefaultSceneSettings(),
      focusToken: 0,
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
        focusToken: 0,
      }
    }),

  ...createKeyframeSlice(set),

  play: () =>
    set((state) => {
      if (state.animation.tracks.length === 0) return {}
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
    const clamped = Math.max(0, Math.min(state.animation.duration, time))
    if (!state.playback.playing) applySampledObjectsSilently(clamped)
    set((current) => ({ playback: { ...current.playback, currentTime: clamped } }))
  },

  setPlaybackTime: (time) =>
    set((state) => ({ playback: { ...state.playback, currentTime: time } })),

  toggleLoop: () => set((state) => ({ playback: { ...state.playback, loop: !state.playback.loop } })),

  setSelectedKeyframes: (keys) => set({ selectedKeyframes: keys }),

  setSceneBackgroundColor: (color) =>
    set((state) => ({ sceneSettings: { ...state.sceneSettings, backgroundColor: color } })),

  setSceneGridVisible: (visible) =>
    set((state) => ({ sceneSettings: { ...state.sceneSettings, gridVisible: visible } })),

  requestFocusSelected: () => set((state) => ({ focusToken: state.focusToken + 1 })),
    }),
    {
      limit: 100,
      // 跟踪场景数据 + 动画轨道切片；界面态/播放态变更不入历史
      partialize: (state): TrackedState => ({ objects: state.objects, animation: state.animation }),
      // 对象数组与动画对象都走不可变更新，引用相等即无实质变化 → 跳过记录
      equality: (a, b) => a.objects === b.objects && a.animation === b.animation,
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
