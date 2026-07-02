import { create } from 'zustand'
import {
  PRIMITIVE_KIND_LABELS,
  createCameraObject,
  createCharacterObject,
  createPrimitiveObject,
  pickDefaultColor,
} from '../domain/sceneDefaults'
import { clonePose } from '../domain/poseTypes'
import type { StagePoseJointId, StagePosePreset } from '../domain/poseTypes'
import type {
  StageGizmoMode,
  StageObject,
  StageObjectPatch,
  StagePrimitiveKind,
  StageTransform,
  StageVec3,
} from '../domain/sceneTypes'

interface CameraStageState {
  objects: StageObject[]
  selectedId: string | null
  gizmoMode: StageGizmoMode
  addPrimitive: (kind: StagePrimitiveKind) => void
  addCharacter: () => void
  addCamera: () => void
  removeObject: (id: string) => void
  setSelected: (id: string | null) => void
  setGizmoMode: (mode: StageGizmoMode) => void
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

export const useCameraStageStore = create<CameraStageState>((set) => ({
  objects: [],
  selectedId: null,
  gizmoMode: 'translate',

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
      return { objects: [...state.objects, object], selectedId: object.id }
    }),

  removeObject: (id) =>
    set((state) => ({
      objects: state.objects.filter((item) => item.id !== id),
      selectedId: state.selectedId === id ? null : state.selectedId,
    })),

  setSelected: (id) => set({ selectedId: id }),

  setGizmoMode: (mode) => set({ gizmoMode: mode }),

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
