import { create } from 'zustand'
import type { StoreApi } from 'zustand'
import { temporal } from 'zundo'
import {
  PRIMITIVE_KIND_LABELS,
  createCameraObject,
  createCharacterObject,
  createPrimitiveObject,
  pickDefaultColor,
} from '../domain/sceneDefaults'
import { getCameraObjects } from '../domain/cameraUtils'
import { clonePose } from '../domain/poseTypes'
import type { StagePoseJointId, StagePosePreset } from '../domain/poseTypes'
import type { StageSceneSnapshotInput } from '../domain/sceneSerialization'
import type {
  StageGizmoMode,
  StageObject,
  StageObjectPatch,
  StagePrimitiveKind,
  StageTransform,
  StageVec3,
  StageViewMode,
} from '../domain/sceneTypes'

interface CameraStageState {
  objects: StageObject[]
  selectedId: string | null
  gizmoMode: StageGizmoMode
  viewMode: StageViewMode
  activeCameraId: string | null
  /** 当前已保存工程 id；null 表示尚未保存过（新场景） */
  currentProjectId: string | null
  /** 当前工程名（新场景用默认名，保存后与工程记录一致） */
  currentProjectName: string
  addPrimitive: (kind: StagePrimitiveKind) => void
  addCharacter: () => void
  addCamera: () => void
  removeObject: (id: string) => void
  setSelected: (id: string | null) => void
  setGizmoMode: (mode: StageGizmoMode) => void
  setViewMode: (mode: StageViewMode) => void
  setActiveCameraId: (id: string | null) => void
  updateObject: (id: string, patch: StageObjectPatch) => void
  updateTransform: (id: string, patch: Partial<StageTransform>) => void
  /** 更新角色单个关节的欧拉偏移（角度制） */
  updatePoseJoint: (id: string, jointId: StagePoseJointId, euler: StageVec3) => void
  /** 一键应用预设姿势（整体替换当前姿态） */
  applyPosePreset: (id: string, preset: StagePosePreset) => void
  /** 关联到某个已保存工程（保存/加载后调用），仅更新工程标识不动场景数据 */
  bindProject: (id: string, name: string) => void
  /** 重置为空白新场景（新建工程用）：清空对象与工程标识，复位界面态 */
  newScene: (name: string) => void
  /** 用工程快照整体重置场景（加载工程用）；同时复位选中/视角等界面态 */
  loadSnapshot: (snapshot: StageSceneSnapshotInput, project: { id: string; name: string }) => void
}

/** 新场景默认工程名 */
export const CAMERA_STAGE_DEFAULT_PROJECT_NAME = '未命名场景'

/** 撤销历史只跟踪场景数据切片（对象列表），界面态（选中/视角/工程标识）不入历史 */
type TrackedState = Pick<CameraStageState, 'objects'>

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

  removeObject: (id) =>
    set((state) => {
      const objects = state.objects.filter((item) => item.id !== id)
      const activeCameraId = state.activeCameraId === id ? firstCameraId(objects) : state.activeCameraId
      return {
        objects,
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
    set((state) => ({
      objects: state.objects.map((item) =>
        item.id === id ? ({ ...item, ...patch } as StageObject) : item,
      ),
    })),

  updateTransform: (id, patch) =>
    set((state) => ({
      objects: state.objects.map((item) =>
        item.id === id ? { ...item, transform: { ...item.transform, ...patch } } : item,
      ),
    })),

  updatePoseJoint: (id, jointId, euler) =>
    set((state) => ({
      objects: state.objects.map((item) =>
        item.id === id && item.type === 'character'
          ? { ...item, pose: { ...item.pose, joints: { ...item.pose.joints, [jointId]: euler } } }
          : item,
      ),
    })),

  applyPosePreset: (id, preset) =>
    set((state) => ({
      objects: state.objects.map((item) =>
        item.id === id && item.type === 'character' ? { ...item, pose: clonePose(preset) } : item,
      ),
    })),

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
      }
    }),
    }),
    {
      limit: 100,
      // 只跟踪场景数据切片；界面态变更不入历史
      partialize: (state): TrackedState => ({ objects: state.objects }),
      // 对象数组走不可变更新，引用相等即无实质变化 → 跳过记录（避免选中/视角变更污染历史）
      equality: (a, b) => a.objects === b.objects,
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
