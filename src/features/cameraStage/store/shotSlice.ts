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
import { isCameraId } from '../domain/cameraUtils'
import { clampHold, clampTransition, isTimeInShotStaticSegment, quantizeToFrame } from '../simple/timeline/shotClipGeometry'
import type { CameraStageState } from './cameraStageStore'

const logger = createLogger('features.cameraStage.simple')

export type ShotSliceActions = Pick<
  CameraStageState,
  | 'addShot'
  | 'moveShotTime'
  | 'removeShot'
  | 'reorderShot'
  | 'selectShot'
  | 'setSelectedShotIdOnly'
  | 'updateShotTiming'
  | 'updateShotName'
  | 'updateShotTransition'
  | 'updateShotCamera'
  | 'updateShotContinuity'
  | 'setSimpleAutoKeyframe'
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

function shotAtTime(shots: StageShot[], time: number, fps: number): StageShot | undefined {
  const epsilon = 1 / (2 * Math.max(1, fps))
  return shots.find((shot) => Math.abs(shot.time - time) <= epsilon)
}

function syncTransitionDurations(shots: StageShot[]): StageShot[] {
  return shots.map((shot, index) => ({
    ...shot,
    hold: 0,
    transitionDuration: Math.max(0, (shots[index + 1]?.time ?? shot.time) - shot.time),
  }))
}

function insertCapturedShot(
  state: CameraStageState,
  objects: StageObject[],
): { shots: StageShot[]; shot: StageShot } {
  const time = quantizeToFrame(state.playback.currentTime, state.animation.fps)
  const shot = createShot(objects, `关键帧 ${state.shots.length + 1}`, state.activeCameraId, time)
  const shots = syncTransitionDurations([...state.shots, shot].sort((a, b) => a.time - b.time))
  return { shots, shot }
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
  if (state.editorMode !== 'simple' || state.playback.playing) return { objects }
  if (!canCaptureAtCurrentTime(state)) {
    if (state.simpleAutoKeyframe) {
      const inserted = insertCapturedShot(state, objects)
      logger.debug('自动插入状态关键帧', {
        event: 'simple_mode.auto_keyframe.inserted',
        shotId: inserted.shot.id,
        time: inserted.shot.time,
      })
      return {
        objects,
        shots: inserted.shots,
        selectedShotId: inserted.shot.id,
        animation: compile(inserted.shots, objects),
      }
    }
    if (state.selectedShotId) logCaptureSkipped(state.selectedShotId)
    return { objects }
  }
  const shots = captureObjectsIntoShot(state.shots, state.selectedShotId, objects, objectIds)
  return { objects, shots, animation: compile(shots, objects) }
}

export function createShotSlice(set: StoreApi<CameraStageState>['setState']): ShotSliceActions {
  return {
    addShot: () => set((state) => {
      const time = quantizeToFrame(state.playback.currentTime, state.animation.fps)
      const existing = shotAtTime(state.shots, time, state.animation.fps)
      if (existing) {
        const shots = captureObjectsIntoShot(state.shots, existing.id, state.objects)
        return { shots, selectedShotId: existing.id, animation: compile(shots, state.objects) }
      }
      const shot = createShot(state.objects, `关键帧 ${state.shots.length + 1}`, state.activeCameraId, time)
      const shots = syncTransitionDurations([...state.shots, shot].sort((a, b) => a.time - b.time))
      logger.debug('新增简易模式镜头卡', { event: 'simple_mode.shot.added', shotCount: shots.length })
      return {
        shots,
        selectedShotId: shot.id,
        animation: compile(shots, state.objects),
        playback: { ...state.playback, playing: false, currentTime: time },
      }
    }),
    moveShotTime: (id, requestedTime) => set((state) => {
      const index = state.shots.findIndex((shot) => shot.id === id)
      if (index < 0) return {}
      const frame = 1 / Math.max(1, state.animation.fps)
      const minimum = index === 0 ? 0 : state.shots[index - 1].time + frame
      const maximum = index === state.shots.length - 1
        ? Number.POSITIVE_INFINITY
        : state.shots[index + 1].time - frame
      const time = Math.min(maximum, Math.max(minimum, quantizeToFrame(requestedTime, state.animation.fps)))
      if (Math.abs(time - state.shots[index].time) < 1e-6) return {}
      const shots = syncTransitionDurations(
        state.shots.map((shot) => shot.id === id ? { ...shot, time } : shot).sort((a, b) => a.time - b.time),
      )
      logger.debug('移动状态关键帧', { event: 'simple_mode.keyframe.moved', shotId: id, time })
      return {
        shots,
        animation: compile(shots, state.objects),
        playback: { ...state.playback, playing: false, currentTime: time },
      }
    }),
    removeShot: (id) => set((state) => {
      const index = state.shots.findIndex((shot) => shot.id === id)
      if (index < 0) return {}
      const shots = syncTransitionDurations(state.shots.filter((shot) => shot.id !== id))
      const selectedShotId = state.selectedShotId === id
        ? shots[Math.min(index, shots.length - 1)]?.id ?? null
        : state.selectedShotId
      return { shots, selectedShotId, animation: compile(shots, state.objects) }
    }),
    reorderShot: (id, toIndex) => set((state) => {
      const fromIndex = state.shots.findIndex((shot) => shot.id === id)
      if (fromIndex < 0 || state.shots.length < 2) return {}
      const times = state.shots.map((shot) => shot.time)
      const shots = [...state.shots]
      const [shot] = shots.splice(fromIndex, 1)
      shots.splice(Math.max(0, Math.min(shots.length, toIndex)), 0, shot)
      const retimed = syncTransitionDurations(shots.map((shot, index) => ({ ...shot, time: times[index] })))
      return { shots: retimed, animation: compile(retimed, state.objects) }
    }),
    selectShot: (id) => set((state) => {
      const index = state.shots.findIndex((shot) => shot.id === id)
      if (index < 0) return {}
      const shot = state.shots[index]
      const time = shot.time
      // 点卡 = 进入该卡的拍摄视角编辑（显式用户动作，允许写 store，重要记录 005/3.2）；
      // 卡未指定机位，或机位指向已删除的对象时，activeCameraId 保持不变（不写入无效 id）。
      const activeCameraId = isCameraId(state.objects, shot.cameraId) ? (shot.cameraId as string) : state.activeCameraId
      return {
        selectedShotId: id,
        objects: applyShotToObjects(state.objects, shot),
        activeCameraId,
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
      let shots = state.shots.map((shot) => shot.id === id ? {
        ...shot,
        ...(patch.hold === undefined ? {} : { hold: quantizeToFrame(clampHold(patch.hold, fps), fps) }),
        ...(patch.transitionDuration === undefined
          ? {}
          : { transitionDuration: quantizeToFrame(clampTransition(patch.transitionDuration, fps), fps) }),
      } : shot)
      if (patch.transitionDuration !== undefined) {
        const index = shots.findIndex((shot) => shot.id === id)
        if (index >= 0 && shots[index + 1]) {
          const nextTime = quantizeToFrame(
            shots[index].time + clampTransition(patch.transitionDuration, fps),
            fps,
          )
          const afterNext = shots[index + 2]
          const upper = afterNext === undefined
            ? nextTime
            : afterNext.time - 1 / Math.max(1, fps)
          shots = shots.map((shot, shotIndex) => shotIndex === index + 1
            ? { ...shot, time: Math.min(upper, nextTime) }
            : shot)
        }
      }
      shots = syncTransitionDurations(shots)
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
    /**
     * 修改某张镜头卡的拍摄机位（重要记录 005）。重编译是必须的：机位变化可能触发或解除
     * 与相邻卡之间的强制硬切（buildShotTimeline 的有效过渡时长会随之变化）。
     */
    updateShotCamera: (id, cameraId) => set((state) => {
      const shots = state.shots.map((shot) => shot.id === id ? { ...shot, cameraId } : shot)
      logger.debug('更新镜头卡拍摄机位', {
        event: 'simple_mode.shot.camera_updated',
        shotId: id,
        cameraId,
      })
      return { shots, animation: compile(shots, state.objects) }
    }),
    updateShotContinuity: (id, continuity) => set((state) => {
      const shots = state.shots.map((shot) => shot.id === id ? { ...shot, continuity } : shot)
      return { shots, animation: compile(shots, state.objects) }
    }),
    setSimpleAutoKeyframe: (enabled) => set({ simpleAutoKeyframe: enabled }),
    captureIntoSelectedShot: (objectIds) => set((state) => {
      if (state.editorMode !== 'simple' || state.playback.playing || !state.selectedShotId) return {}
      if (!canCaptureAtCurrentTime(state)) {
        if (state.simpleAutoKeyframe) {
          const inserted = insertCapturedShot(state, state.objects)
          return {
            shots: inserted.shots,
            selectedShotId: inserted.shot.id,
            animation: compile(inserted.shots, state.objects),
          }
        }
        logCaptureSkipped(state.selectedShotId)
        return {}
      }
      const shots = captureObjectsIntoShot(state.shots, state.selectedShotId, state.objects, objectIds)
      return shots === state.shots ? {} : { shots, animation: compile(shots, state.objects) }
    }),
    setEditorMode: (editorMode: StageEditorMode) => set((state) => {
      if (state.editorMode === 'pro' && editorMode === 'simple') return {}
      if (editorMode === state.editorMode && !(editorMode === 'simple' && state.shots.length === 0)) return {}
      const shots = editorMode === 'simple' && state.shots.length === 0
        ? [createShot(state.objects, '关键帧 1', state.activeCameraId)]
        : state.shots
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
