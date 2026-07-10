import type { StoreApi } from 'zustand'
import { createLogger } from '@/core/logging'
import { compileShotsToAnimation } from '../domain/shotCompiler'
import {
  captureShotObjectState,
  createShot,
  type StageEditorMode,
  type StageShot,
  type StageShotTransitionObjectDetail,
} from '../domain/shotTypes'
import type { StageCameraMove } from '../domain/shotTypes'
import type { StageObject } from '../domain/sceneTypes'
import type { CameraStageState } from './cameraStageStore'

const logger = createLogger('features.cameraStage.simple')

export type ShotSliceActions = Pick<
  CameraStageState,
  | 'addShot'
  | 'removeShot'
  | 'reorderShot'
  | 'selectShot'
  | 'updateShotTiming'
  | 'updateShotName'
  | 'updateShotTransition'
  | 'captureIntoSelectedShot'
  | 'setEditorMode'
>

function compile(shots: StageShot[], objects: StageObject[]): CameraStageState['animation'] {
  const animation = compileShotsToAnimation(shots, objects)
  logger.debug('简易模式镜头卡编译完成', {
    event: 'simple_mode.compile.completed',
    shotCount: shots.length,
    trackCount: animation.tracks.length,
  })
  return animation
}

export function applyShotToObjects(objects: StageObject[], shot: StageShot): StageObject[] {
  return objects.map((object) => {
    const snapshot = shot.objectStates[object.id]
    if (!snapshot) return object
    if (object.type === 'camera') {
      return { ...object, transform: structuredClone(snapshot.transform), color: snapshot.color,
        fov: snapshot.fov ?? object.fov, lookAt: structuredClone(snapshot.lookAt ?? object.lookAt) }
    }
    if (object.type === 'character') {
      return { ...object, transform: structuredClone(snapshot.transform), color: snapshot.color,
        pose: structuredClone(snapshot.pose ?? object.pose), motion: structuredClone(snapshot.motion ?? object.motion) }
    }
    return { ...object, transform: structuredClone(snapshot.transform), color: snapshot.color }
  })
}

export function captureObjectsIntoShot(
  shots: StageShot[],
  selectedShotId: string | null,
  objects: StageObject[],
  objectIds?: string[],
): StageShot[] {
  if (!selectedShotId) return shots
  const allowedIds = objectIds ? new Set(objectIds) : null
  return shots.map((shot) => {
    if (shot.id !== selectedShotId) return shot
    const objectStates = { ...shot.objectStates }
    for (const object of objects) {
      if (!allowedIds || allowedIds.has(object.id)) objectStates[object.id] = captureShotObjectState(object)
    }
    return { ...shot, objectStates }
  })
}

export function syncAddedObjectToShots(shots: StageShot[], object: StageObject): StageShot[] {
  const snapshot = captureShotObjectState(object)
  return shots.map((shot) => ({ ...shot, objectStates: { ...shot.objectStates, [object.id]: snapshot } }))
}

export function syncRemovedObjectFromShots(shots: StageShot[], objectId: string): StageShot[] {
  return shots.map((shot) => {
    const objectStates = { ...shot.objectStates }
    const perObject = { ...shot.transition.perObject }
    const cameraMoves = { ...shot.transition.cameraMoves }
    delete objectStates[objectId]
    delete perObject[objectId]
    delete cameraMoves[objectId]
    return { ...shot, objectStates, transition: { perObject, cameraMoves } }
  })
}

export function compileSimpleEdit(
  state: CameraStageState,
  objects: StageObject[],
  objectIds: string[],
): Partial<CameraStageState> {
  if (state.editorMode !== 'simple' || state.playback.playing || !state.selectedShotId) return { objects }
  const shots = captureObjectsIntoShot(state.shots, state.selectedShotId, objects, objectIds)
  return { objects, shots, animation: compile(shots, objects) }
}

function shotStartTime(shots: StageShot[], index: number): number {
  let time = 0
  for (let cursor = 0; cursor < index; cursor += 1) {
    time += Math.max(0, shots[cursor].hold) + Math.max(0, shots[cursor].transitionDuration)
  }
  return time
}

export function createShotSlice(set: StoreApi<CameraStageState>['setState']): ShotSliceActions {
  return {
    addShot: () => set((state) => {
      const shot = createShot(state.objects, `片段 ${state.shots.length + 1}`)
      const selectedIndex = state.shots.findIndex((item) => item.id === state.selectedShotId)
      const insertIndex = selectedIndex < 0 ? state.shots.length : selectedIndex + 1
      const shots = [...state.shots.slice(0, insertIndex), shot, ...state.shots.slice(insertIndex)]
      logger.debug('新增简易模式镜头卡', { event: 'simple_mode.shot.added', shotCount: shots.length })
      return { shots, selectedShotId: shot.id, animation: compile(shots, state.objects) }
    }),
    removeShot: (id) => set((state) => {
      const index = state.shots.findIndex((shot) => shot.id === id)
      if (index < 0) return {}
      const shots = state.shots.filter((shot) => shot.id !== id)
      const selectedShotId = state.selectedShotId === id
        ? shots[Math.min(index, shots.length - 1)]?.id ?? null
        : state.selectedShotId
      return { shots, selectedShotId, animation: compile(shots, state.objects) }
    }),
    reorderShot: (id, toIndex) => set((state) => {
      const fromIndex = state.shots.findIndex((shot) => shot.id === id)
      if (fromIndex < 0 || state.shots.length < 2) return {}
      const shots = [...state.shots]
      const [shot] = shots.splice(fromIndex, 1)
      shots.splice(Math.max(0, Math.min(shots.length, toIndex)), 0, shot)
      return { shots, animation: compile(shots, state.objects) }
    }),
    selectShot: (id) => set((state) => {
      const index = state.shots.findIndex((shot) => shot.id === id)
      if (index < 0) return {}
      const time = shotStartTime(state.shots, index)
      return {
        selectedShotId: id,
        objects: applyShotToObjects(state.objects, state.shots[index]),
        playback: { ...state.playback, playing: false, currentTime: time },
      }
    }),
    updateShotTiming: (id, patch) => set((state) => {
      const shots = state.shots.map((shot) => shot.id === id ? {
        ...shot,
        ...(patch.hold === undefined ? {} : { hold: Math.max(0, patch.hold) }),
        ...(patch.transitionDuration === undefined ? {} : { transitionDuration: Math.max(0, patch.transitionDuration) }),
      } : shot)
      return { shots, animation: compile(shots, state.objects) }
    }),
    updateShotName: (id, name) => set((state) => ({
      shots: state.shots.map((shot) => shot.id === id ? { ...shot, name: name.trim() || shot.name } : shot),
    })),
    updateShotTransition: (id, patch) => set((state) => {
      const shots = state.shots.map((shot) => shot.id === id ? {
        ...shot,
        transition: {
          perObject: patch.perObject ? { ...shot.transition.perObject, ...patch.perObject } : shot.transition.perObject,
          cameraMoves: patch.cameraMoves ? { ...shot.transition.cameraMoves, ...patch.cameraMoves } : shot.transition.cameraMoves,
        },
      } : shot)
      return { shots, animation: compile(shots, state.objects) }
    }),
    captureIntoSelectedShot: (objectIds) => set((state) => {
      if (state.editorMode !== 'simple' || state.playback.playing) return {}
      const shots = captureObjectsIntoShot(state.shots, state.selectedShotId, state.objects, objectIds)
      return shots === state.shots ? {} : { shots, animation: compile(shots, state.objects) }
    }),
    setEditorMode: (editorMode: StageEditorMode) => set((state) => {
      if (editorMode === state.editorMode) return {}
      const shots = editorMode === 'simple' && state.shots.length === 0 ? [createShot(state.objects, '片段 1')] : state.shots
      return { editorMode, shots, selectedShotId: shots[0]?.id ?? null,
        ...(editorMode === 'simple' ? { animation: compile(shots, state.objects) } : {}) }
    }),
  }
}

export type ShotTimingPatch = Partial<Pick<StageShot, 'hold' | 'transitionDuration'>>
export interface ShotTransitionPatch {
  perObject?: Record<string, StageShotTransitionObjectDetail>
  cameraMoves?: Record<string, StageCameraMove>
}
