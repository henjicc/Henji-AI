import { create } from 'zustand'
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

export const useCameraStageStore = create<CameraStageState>((set) => ({
  objects: [],
  selectedId: null,
  gizmoMode: 'translate',
  viewMode: 'director',
  activeCameraId: null,

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
}))
