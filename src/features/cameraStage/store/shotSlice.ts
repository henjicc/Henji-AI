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
import { clampHold, clampTransition, isTimeInShotStaticSegment, quantizeToFrame } from '../simple/timeline/shotClipGeometry'
import type { CameraStageState } from './cameraStageStore'

const logger = createLogger('features.cameraStage.simple')

export type ShotSliceActions = Pick<
  CameraStageState,
  | 'addShot'
  | 'removeShot'
  | 'reorderShot'
  | 'selectShot'
  | 'setSelectedShotIdOnly'
  | 'updateShotTiming'
  | 'updateShotName'
  | 'updateShotTransition'
  | 'captureIntoSelectedShot'
  | 'setEditorMode'
  | 'bakeToProMode'
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

/**
 * 播放头是否允许把编辑捕获进选中卡：必须落在选中卡自己的静止段内（重要记录 003）。
 * 同时覆盖两种误录场景——过渡段插值状态、播放头停在别的卡上却把编辑录进当前选中卡。
 */
function canCaptureAtCurrentTime(state: CameraStageState): boolean {
  if (!state.selectedShotId) return false
  return isTimeInShotStaticSegment(state.shots, state.selectedShotId, state.playback.currentTime, state.animation.fps)
}

function logCaptureSkipped(selectedShotId: string): void {
  logger.debug('播放头不在选中卡静止段内，跳过自动记录', {
    event: 'simple_mode.capture.skipped_in_transition',
    selectedShotId,
  })
}

export function compileSimpleEdit(
  state: CameraStageState,
  objects: StageObject[],
  objectIds: string[],
): Partial<CameraStageState> {
  if (state.editorMode !== 'simple' || state.playback.playing || !state.selectedShotId) return { objects }
  if (!canCaptureAtCurrentTime(state)) {
    logCaptureSkipped(state.selectedShotId)
    return { objects }
  }
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
      // 播放头随选中同步跳到新卡起点（对齐 selectShot 的语义）：新卡创建时已从当前对象状态取快照，
      // 播放头留在旧位置会导致刚建卡就落在"别的卡静止段/过渡段"，被 1.3 的捕获守卫拦截，无法继续编辑新卡。
      const time = shotStartTime(shots, insertIndex)
      return {
        shots,
        selectedShotId: shot.id,
        animation: compile(shots, state.objects),
        playback: { ...state.playback, playing: false, currentTime: time },
      }
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
    /**
     * 只切换选中卡，不应用快照、不移动播放头（界面态，不进撤销历史）。
     * 用于播放头 scrub 落入某静止段时的"选中跟随"（重要记录 003 前置逻辑）：
     * 静止段内采样值本就等于卡快照，重复调用 selectShot 只会多余地污染撤销历史。
     */
    setSelectedShotIdOnly: (id) => set((state) => {
      if (state.selectedShotId === id) return {}
      return { selectedShotId: id }
    }),
    updateShotTiming: (id, patch) => set((state) => {
      const fps = state.animation.fps
      const shots = state.shots.map((shot) => shot.id === id ? {
        ...shot,
        ...(patch.hold === undefined ? {} : { hold: quantizeToFrame(clampHold(patch.hold, fps), fps) }),
        ...(patch.transitionDuration === undefined
          ? {}
          : { transitionDuration: quantizeToFrame(clampTransition(patch.transitionDuration, fps), fps) }),
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
      if (state.editorMode !== 'simple' || state.playback.playing || !state.selectedShotId) return {}
      if (!canCaptureAtCurrentTime(state)) {
        logCaptureSkipped(state.selectedShotId)
        return {}
      }
      const shots = captureObjectsIntoShot(state.shots, state.selectedShotId, state.objects, objectIds)
      return shots === state.shots ? {} : { shots, animation: compile(shots, state.objects) }
    }),
    setEditorMode: (editorMode: StageEditorMode) => set((state) => {
      if (state.editorMode === 'pro' && editorMode === 'simple') return {}
      if (editorMode === state.editorMode && !(editorMode === 'simple' && state.shots.length === 0)) return {}
      const shots = editorMode === 'simple' && state.shots.length === 0 ? [createShot(state.objects, '片段 1')] : state.shots
      return { editorMode, shots, selectedShotId: shots[0]?.id ?? null,
        ...(editorMode === 'simple' ? { animation: compile(shots, state.objects) } : {}) }
    }),
    bakeToProMode: () => set((state) => {
      if (state.editorMode !== 'simple') return {}
      const animation = compile(state.shots, state.objects)
      return {
        animation,
        editorMode: 'pro',
        shots: [],
        selectedShotId: null,
        playback: { ...state.playback, playing: false },
      }
    }),
  }
}

export type ShotTimingPatch = Partial<Pick<StageShot, 'hold' | 'transitionDuration'>>
export interface ShotTransitionPatch {
  perObject?: Record<string, StageShotTransitionObjectDetail>
  cameraMoves?: Record<string, StageCameraMove>
}
