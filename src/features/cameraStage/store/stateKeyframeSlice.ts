import type { StoreApi } from 'zustand'
import { createLogger } from '@/core/logging'
import { compileStateKeyframesToAnimation } from '../domain/stateKeyframeCompiler'
import {
  captureStateKeyframeObjectState,
  createStateKeyframe,
  type StageCameraMovePreset,
  type StageStateKeyframe,
  type StageSpatialPath,
  type StageStateKeyframeTransitionObjectDetail,
} from '../domain/stateKeyframeTypes'
import type { StageCameraLookAt, StageObject } from '../domain/sceneTypes'
import { isCameraId } from '../domain/cameraUtils'
import { createCameraPresetPath } from '../domain/spatialPath'
import { markSpatialPathCustom } from '../domain/spatialPath'
import { clampHold, clampTransition, isTimeInStateKeyframeStaticSegment, quantizeToFrame } from '../stateKeyframes/timeline/stateKeyframeClipGeometry'
import type { CameraStageState } from './cameraStageStore'
import { applyAnimationAtTime } from './playbackSampling'

const logger = createLogger('features.cameraStage.stateKeyframes')

export type StateKeyframeSliceActions = Pick<
  CameraStageState,
  | 'addStateKeyframe'
  | 'moveStateKeyframeTime'
  | 'removeStateKeyframe'
  | 'removeStateKeyframes'
  | 'setSelectedStateKeyframeIds'
  | 'reorderStateKeyframe'
  | 'selectStateKeyframe'
  | 'setSelectedStateKeyframeIdOnly'
  | 'updateStateKeyframeTiming'
  | 'updateStateKeyframeName'
  | 'updateStateKeyframeTransition'
  | 'setStateKeyframeSpatialPath'
  | 'applyCameraPathPreset'
  | 'setStateKeyframePathAnchor'
  | 'updateStateKeyframeCamera'
  | 'updateStateKeyframeContinuity'
  | 'captureIntoSelectedStateKeyframe'
>

function compile(stateKeyframes: StageStateKeyframe[], objects: StageObject[]): CameraStageState['animation'] {
  const animation = compileStateKeyframesToAnimation(stateKeyframes, objects)
  logger.debug('状态关键帧编译完成', {
    event: 'state_keyframe.compile.completed',
    stateKeyframeCount: stateKeyframes.length,
    trackCount: animation.tracks.length,
  })
  return animation
}

function compileAndAlignCurrentFrame(
  state: CameraStageState,
  stateKeyframes: StageStateKeyframe[],
  objects: StageObject[] = state.objects,
): Pick<CameraStageState, 'stateKeyframes' | 'animation' | 'objects'> {
  const animation = compile(stateKeyframes, objects)
  return {
    stateKeyframes,
    animation,
    objects: state.playback.playing
      ? objects
      : applyAnimationAtTime(objects, animation, state.playback.currentTime),
  }
}

/**
 * 注视目标是摄像机级全局设置，不属于时间轴关键帧。
 * 状态关键帧快照保留 lookAt 以供编译/序列化，因此修改时必须同步
 * 所有既有状态关键帧，避免切卡后回退到旧目标；整个过程不插入新的状态关键帧。
 */
export function syncCameraLookAtAcrossStateKeyframes(
  state: CameraStageState,
  objects: StageObject[],
  cameraId: string,
  lookAt: StageCameraLookAt,
): Pick<CameraStageState, 'stateKeyframes' | 'animation' | 'objects'> {
  const stateKeyframes = state.stateKeyframes.map((stateKeyframe) => {
    const cameraState = stateKeyframe.objectStates[cameraId]
    if (!cameraState) return stateKeyframe
    return {
      ...stateKeyframe,
      objectStates: {
        ...stateKeyframe.objectStates,
        [cameraId]: { ...cameraState, lookAt: structuredClone(lookAt) },
      },
    }
  })
  logger.debug('摄像机注视目标已同步到全部状态关键帧', {
    event: 'state_keyframe.camera.look_at.synced',
    cameraId,
    stateKeyframeCount: stateKeyframes.length,
    lookAtMode: lookAt.mode,
  })
  return compileAndAlignCurrentFrame(state, stateKeyframes, objects)
}

export function applyStateKeyframeToObjects(objects: StageObject[], stateKeyframe: StageStateKeyframe): StageObject[] {
  return objects.map((object) => {
    const snapshot = stateKeyframe.objectStates[object.id]
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

export function captureObjectsIntoStateKeyframe(
  stateKeyframes: StageStateKeyframe[],
  selectedStateKeyframeId: string | null,
  objects: StageObject[],
  objectIds?: string[],
): StageStateKeyframe[] {
  if (!selectedStateKeyframeId) return stateKeyframes
  const allowedIds = objectIds ? new Set(objectIds) : null
  return stateKeyframes.map((stateKeyframe) => {
    if (stateKeyframe.id !== selectedStateKeyframeId) return stateKeyframe
    const objectStates = { ...stateKeyframe.objectStates }
    for (const object of objects) {
      if (!allowedIds || allowedIds.has(object.id)) objectStates[object.id] = captureStateKeyframeObjectState(object)
    }
    return { ...stateKeyframe, objectStates }
  })
}

export function syncAddedObjectToStateKeyframes(stateKeyframes: StageStateKeyframe[], object: StageObject): StageStateKeyframe[] {
  const snapshot = captureStateKeyframeObjectState(object)
  return stateKeyframes.map((stateKeyframe) => ({ ...stateKeyframe, objectStates: { ...stateKeyframe.objectStates, [object.id]: snapshot } }))
}

export function syncRemovedObjectFromStateKeyframes(stateKeyframes: StageStateKeyframe[], objectId: string): StageStateKeyframe[] {
  return stateKeyframes.map((stateKeyframe) => {
    const objectStates = { ...stateKeyframe.objectStates }
    const perObject = { ...stateKeyframe.transition.perObject }
    delete objectStates[objectId]
    delete perObject[objectId]
    return { ...stateKeyframe, objectStates, transition: { perObject } }
  })
}

/**
 * 播放头是否允许把编辑捕获进选中的状态关键帧：必须落在它自己的静止段内（重要记录 003）。
 * 同时覆盖两种误录场景——过渡段插值状态、播放头停在别的状态关键帧上却写入当前选中点。
 */
function canCaptureAtCurrentTime(state: CameraStageState): boolean {
  if (!state.selectedStateKeyframeId) return false
  return isTimeInStateKeyframeStaticSegment(state.stateKeyframes, state.selectedStateKeyframeId, state.playback.currentTime, state.animation.fps)
}

function stateKeyframeAtTime(stateKeyframes: StageStateKeyframe[], time: number, fps: number): StageStateKeyframe | undefined {
  const epsilon = 1 / (2 * Math.max(1, fps))
  return stateKeyframes.find((stateKeyframe) => Math.abs(stateKeyframe.time - time) <= epsilon)
}

function syncTransitionDurations(stateKeyframes: StageStateKeyframe[]): StageStateKeyframe[] {
  return stateKeyframes.map((stateKeyframe, index) => ({
    ...stateKeyframe,
    hold: 0,
    transitionDuration: Math.max(0, (stateKeyframes[index + 1]?.time ?? stateKeyframe.time) - stateKeyframe.time),
  }))
}

function resolveStateKeyframeTarget(stateKeyframe: StageStateKeyframe, objectId: string, objects: StageObject[]): StageObject['transform']['position'] {
  const cameraState = stateKeyframe.objectStates[objectId]
  const lookAt = cameraState?.lookAt
  if (!lookAt) return { x: 0, y: 0, z: 0 }
  if (lookAt.mode === 'manual') return { ...lookAt.target }
  const target = objects.find((object) => object.id === lookAt.objectId)
  const targetState = stateKeyframe.objectStates[lookAt.objectId]
  if (!target || !targetState) return { ...lookAt.fallbackTarget }
  const position = targetState.transform.position
  return target.type === 'character'
    ? { x: position.x, y: position.y + targetState.transform.scale.y, z: position.z }
    : { ...position }
}

function replaceSpatialPath(
  stateKeyframe: StageStateKeyframe,
  objectId: string,
  path: StageSpatialPath | undefined,
): StageStateKeyframe {
  const previous = stateKeyframe.transition.perObject[objectId] ?? {}
  const detail = { ...previous }
  if (path) detail.spatialPath = path
  else delete detail.spatialPath
  return {
    ...stateKeyframe,
    transition: {
      perObject: { ...stateKeyframe.transition.perObject, [objectId]: detail },
    },
  }
}

function insertCapturedStateKeyframe(
  state: CameraStageState,
  objects: StageObject[],
): { stateKeyframes: StageStateKeyframe[]; stateKeyframe: StageStateKeyframe } {
  const time = quantizeToFrame(state.playback.currentTime, state.animation.fps)
  // 播放头正好落在已有状态关键帧的时间点上时更新该点，禁止产生同一时刻的重复点
  //（重复时间会让 buildStateKeyframeTimeline 误判为旧版时序数据，整条时间轴布点退化）
  const existing = stateKeyframeAtTime(state.stateKeyframes, time, state.animation.fps)
  if (existing) {
    return { stateKeyframes: captureObjectsIntoStateKeyframe(state.stateKeyframes, existing.id, objects), stateKeyframe: existing }
  }
  const stateKeyframe = createStateKeyframe(objects, `关键帧 ${state.stateKeyframes.length + 1}`, state.activeCameraId, time)
  const stateKeyframes = syncTransitionDurations([...state.stateKeyframes, stateKeyframe].sort((a, b) => a.time - b.time))
  return { stateKeyframes, stateKeyframe }
}

export function compileStateKeyframeEdit(
  state: CameraStageState,
  objects: StageObject[],
  objectIds: string[],
): Partial<CameraStageState> {
  if (state.playback.playing) return { objects }
  if (!canCaptureAtCurrentTime(state)) {
    const inserted = insertCapturedStateKeyframe(state, objects)
    logger.debug('编辑过渡画面时自动插入状态关键帧', {
      event: 'state_keyframe.auto_keyframe.inserted',
      stateKeyframeId: inserted.stateKeyframe.id,
      time: inserted.stateKeyframe.time,
    })
    return {
      objects,
      stateKeyframes: inserted.stateKeyframes,
      selectedStateKeyframeId: inserted.stateKeyframe.id,
      animation: compile(inserted.stateKeyframes, objects),
      // 状态关键帧按 fps 吸附；播放头必须在同一次 store 更新里落到完全相同的时间。
      // 否则重编译后的视口会继续以吸附前的小数时间采样，在新点旁边再次插值，
      // 用户开始拖动物体/相机的第一瞬间就会看到一次轻微跳变。
      playback: { ...state.playback, currentTime: inserted.stateKeyframe.time },
    }
  }
  const stateKeyframes = captureObjectsIntoStateKeyframe(state.stateKeyframes, state.selectedStateKeyframeId, objects, objectIds)
  return { objects, stateKeyframes, animation: compile(stateKeyframes, objects) }
}

export function createStateKeyframeSlice(set: StoreApi<CameraStageState>['setState']): StateKeyframeSliceActions {
  return {
    addStateKeyframe: () => set((state) => {
      const time = quantizeToFrame(state.playback.currentTime, state.animation.fps)
      const existing = stateKeyframeAtTime(state.stateKeyframes, time, state.animation.fps)
      if (existing) {
        const stateKeyframes = captureObjectsIntoStateKeyframe(state.stateKeyframes, existing.id, state.objects)
        return { stateKeyframes, selectedStateKeyframeId: existing.id, animation: compile(stateKeyframes, state.objects) }
      }
      const stateKeyframe = createStateKeyframe(state.objects, `关键帧 ${state.stateKeyframes.length + 1}`, state.activeCameraId, time)
      const stateKeyframes = syncTransitionDurations([...state.stateKeyframes, stateKeyframe].sort((a, b) => a.time - b.time))
      logger.debug('新增状态关键帧', { event: 'camera_stage.state_keyframe.added', stateKeyframeCount: stateKeyframes.length })
      return {
        stateKeyframes,
        selectedStateKeyframeId: stateKeyframe.id,
        animation: compile(stateKeyframes, state.objects),
        playback: { ...state.playback, playing: false, currentTime: time },
      }
    }),
    moveStateKeyframeTime: (id, requestedTime) => set((state) => {
      const index = state.stateKeyframes.findIndex((stateKeyframe) => stateKeyframe.id === id)
      if (index < 0) return {}
      const frame = 1 / Math.max(1, state.animation.fps)
      const minimum = index === 0 ? 0 : state.stateKeyframes[index - 1].time + frame
      const maximum = index === state.stateKeyframes.length - 1
        ? Number.POSITIVE_INFINITY
        : state.stateKeyframes[index + 1].time - frame
      const time = Math.min(maximum, Math.max(minimum, quantizeToFrame(requestedTime, state.animation.fps)))
      if (Math.abs(time - state.stateKeyframes[index].time) < 1e-6) return {}
      const stateKeyframes = syncTransitionDurations(
        state.stateKeyframes.map((stateKeyframe) => stateKeyframe.id === id ? { ...stateKeyframe, time } : stateKeyframe).sort((a, b) => a.time - b.time),
      )
      logger.debug('移动状态关键帧', { event: 'state_keyframe.keyframe.moved', stateKeyframeId: id, time })
      return {
        stateKeyframes,
        animation: compile(stateKeyframes, state.objects),
        playback: { ...state.playback, playing: false, currentTime: time },
      }
    }),
    removeStateKeyframe: (id) => set((state) => {
      const index = state.stateKeyframes.findIndex((stateKeyframe) => stateKeyframe.id === id)
      if (index < 0) return {}
      const stateKeyframes = syncTransitionDurations(state.stateKeyframes.filter((stateKeyframe) => stateKeyframe.id !== id))
      const selectedStateKeyframeId = state.selectedStateKeyframeId === id
        ? stateKeyframes[Math.min(index, stateKeyframes.length - 1)]?.id ?? null
        : state.selectedStateKeyframeId
      return {
        stateKeyframes,
        selectedStateKeyframeId,
        selectedStateKeyframeIds: state.selectedStateKeyframeIds.filter((stateKeyframeId) => stateKeyframeId !== id),
        animation: compile(stateKeyframes, state.objects),
      }
    }),
    removeStateKeyframes: (ids) => set((state) => {
      const idSet = new Set(ids)
      const stateKeyframes = syncTransitionDurations(state.stateKeyframes.filter((stateKeyframe) => !idSet.has(stateKeyframe.id)))
      if (stateKeyframes.length === state.stateKeyframes.length) return {}
      const firstRemovedIndex = state.stateKeyframes.findIndex((stateKeyframe) => idSet.has(stateKeyframe.id))
      const selectedStateKeyframeId = state.selectedStateKeyframeId && !idSet.has(state.selectedStateKeyframeId)
        ? state.selectedStateKeyframeId
        : stateKeyframes[Math.min(firstRemovedIndex, stateKeyframes.length - 1)]?.id ?? null
      logger.debug('批量删除状态关键帧', {
        event: 'state_keyframe.keyframe.batch_removed',
        removedCount: state.stateKeyframes.length - stateKeyframes.length,
        remainCount: stateKeyframes.length,
      })
      return { stateKeyframes, selectedStateKeyframeId, selectedStateKeyframeIds: [], animation: compile(stateKeyframes, state.objects) }
    }),
    setSelectedStateKeyframeIds: (ids) => set((state) => {
      if (state.selectedStateKeyframeIds.length === 0 && ids.length === 0) return {}
      return { selectedStateKeyframeIds: ids }
    }),
    reorderStateKeyframe: (id, toIndex) => set((state) => {
      const fromIndex = state.stateKeyframes.findIndex((stateKeyframe) => stateKeyframe.id === id)
      if (fromIndex < 0 || state.stateKeyframes.length < 2) return {}
      const times = state.stateKeyframes.map((stateKeyframe) => stateKeyframe.time)
      const stateKeyframes = [...state.stateKeyframes]
      const [stateKeyframe] = stateKeyframes.splice(fromIndex, 1)
      stateKeyframes.splice(Math.max(0, Math.min(stateKeyframes.length, toIndex)), 0, stateKeyframe)
      const retimed = syncTransitionDurations(stateKeyframes.map((stateKeyframe, index) => ({ ...stateKeyframe, time: times[index] })))
      return { stateKeyframes: retimed, animation: compile(retimed, state.objects) }
    }),
    selectStateKeyframe: (id) => set((state) => {
      const index = state.stateKeyframes.findIndex((stateKeyframe) => stateKeyframe.id === id)
      if (index < 0) return {}
      const stateKeyframe = state.stateKeyframes[index]
      const time = stateKeyframe.time
      // 选择状态关键帧 = 进入该时间点的拍摄视角编辑（显式用户动作，允许写 store，重要记录 005/3.2）；
      // 卡未指定机位，或机位指向已删除的对象时，activeCameraId 保持不变（不写入无效 id）。
      const activeCameraId = isCameraId(state.objects, stateKeyframe.cameraId) ? (stateKeyframe.cameraId as string) : state.activeCameraId
      return {
        selectedStateKeyframeId: id,
        selectedStateKeyframeIds: [],
        objects: applyStateKeyframeToObjects(state.objects, stateKeyframe),
        activeCameraId,
        playback: { ...state.playback, playing: false, currentTime: time },
      }
    }),
    /**
     * 只切换选中的状态关键帧，不应用快照、不移动播放头（界面态，不进撤销历史）。
     * 用于播放头 scrub 落入某静止段时的"选中跟随"（重要记录 003 前置逻辑）：
     * 静止段内采样值本就等于卡快照，重复调用 selectStateKeyframe 只会多余地污染撤销历史。
     */
    setSelectedStateKeyframeIdOnly: (id) => set((state) => {
      if (state.selectedStateKeyframeId === id) return {}
      return { selectedStateKeyframeId: id }
    }),
    updateStateKeyframeTiming: (id, patch) => set((state) => {
      const fps = state.animation.fps
      let stateKeyframes = state.stateKeyframes.map((stateKeyframe) => stateKeyframe.id === id ? {
        ...stateKeyframe,
        ...(patch.hold === undefined ? {} : { hold: quantizeToFrame(clampHold(patch.hold, fps), fps) }),
        ...(patch.transitionDuration === undefined
          ? {}
          : { transitionDuration: quantizeToFrame(clampTransition(patch.transitionDuration, fps), fps) }),
      } : stateKeyframe)
      if (patch.transitionDuration !== undefined) {
        const index = stateKeyframes.findIndex((stateKeyframe) => stateKeyframe.id === id)
        if (index >= 0 && stateKeyframes[index + 1]) {
          const nextTime = quantizeToFrame(
            stateKeyframes[index].time + clampTransition(patch.transitionDuration, fps),
            fps,
          )
          const afterNext = stateKeyframes[index + 2]
          const upper = afterNext === undefined
            ? nextTime
            : afterNext.time - 1 / Math.max(1, fps)
          stateKeyframes = stateKeyframes.map((stateKeyframe, stateKeyframeIndex) => stateKeyframeIndex === index + 1
            ? { ...stateKeyframe, time: Math.min(upper, nextTime) }
            : stateKeyframe)
        }
      }
      stateKeyframes = syncTransitionDurations(stateKeyframes)
      return { stateKeyframes, animation: compile(stateKeyframes, state.objects) }
    }),
    updateStateKeyframeName: (id, name) => set((state) => ({
      stateKeyframes: state.stateKeyframes.map((stateKeyframe) => stateKeyframe.id === id ? { ...stateKeyframe, name: name.trim() || stateKeyframe.name } : stateKeyframe),
    })),
    updateStateKeyframeTransition: (id, patch) => set((state) => {
      const stateKeyframes = state.stateKeyframes.map((stateKeyframe) => stateKeyframe.id === id ? {
        ...stateKeyframe,
        transition: {
          perObject: patch.perObject ? { ...stateKeyframe.transition.perObject, ...patch.perObject } : stateKeyframe.transition.perObject,
        },
      } : stateKeyframe)
      return compileAndAlignCurrentFrame(state, stateKeyframes)
    }),
    setStateKeyframeSpatialPath: (stateKeyframeId, objectId, path) => set((state) => {
      const stateKeyframes = state.stateKeyframes.map((stateKeyframe) => (
        stateKeyframe.id === stateKeyframeId ? replaceSpatialPath(stateKeyframe, objectId, path) : stateKeyframe
      ))
      return compileAndAlignCurrentFrame(state, stateKeyframes)
    }),
    applyCameraPathPreset: (stateKeyframeId, objectId, preset: StageCameraMovePreset) => set((state) => {
      const index = state.stateKeyframes.findIndex((stateKeyframe) => stateKeyframe.id === stateKeyframeId)
      if (index < 0 || index >= state.stateKeyframes.length - 1) return {}
      const fromStateKeyframe = state.stateKeyframes[index]
      const nextStateKeyframe = state.stateKeyframes[index + 1]
      const fromPosition = fromStateKeyframe.objectStates[objectId]?.transform.position
      const nextState = nextStateKeyframe.objectStates[objectId]
      if (!fromPosition || !nextState) return {}
      const generated = createCameraPresetPath(preset, fromPosition, resolveStateKeyframeTarget(fromStateKeyframe, objectId, state.objects))
      const stateKeyframes = state.stateKeyframes.map((stateKeyframe, stateKeyframeIndex) => {
        if (stateKeyframeIndex === index) return replaceSpatialPath(stateKeyframe, objectId, generated.path)
        if (stateKeyframeIndex !== index + 1) return stateKeyframe
        return {
          ...stateKeyframe,
          objectStates: {
            ...stateKeyframe.objectStates,
            [objectId]: {
              ...nextState,
              transform: { ...nextState.transform, position: generated.endPosition },
            },
          },
        }
      })
      logger.debug('运镜预设已物化为空间路径', {
        event: 'state_keyframe.camera_path.materialized',
        stateKeyframeId,
        objectId,
        preset: preset.kind,
        knotCount: generated.path.knots.length,
      })
      return compileAndAlignCurrentFrame(state, stateKeyframes)
    }),
    setStateKeyframePathAnchor: (stateKeyframeId, objectId, endpoint, position) => set((state) => {
      const index = state.stateKeyframes.findIndex((stateKeyframe) => stateKeyframe.id === stateKeyframeId)
      const targetIndex = endpoint === 'start' ? index : index + 1
      if (index < 0 || targetIndex >= state.stateKeyframes.length) return {}
      const stateKeyframes = state.stateKeyframes.map((stateKeyframe, stateKeyframeIndex) => {
        if (stateKeyframeIndex === index) {
          const path = stateKeyframe.transition.perObject[objectId]?.spatialPath
          return path ? replaceSpatialPath(stateKeyframe, objectId, markSpatialPathCustom(path)) : stateKeyframe
        }
        return stateKeyframe
      }).map((stateKeyframe, stateKeyframeIndex) => {
        if (stateKeyframeIndex !== targetIndex) return stateKeyframe
        const objectState = stateKeyframe.objectStates[objectId]
        if (!objectState) return stateKeyframe
        return {
          ...stateKeyframe,
          objectStates: {
            ...stateKeyframe.objectStates,
            [objectId]: {
              ...objectState,
              transform: { ...objectState.transform, position },
            },
          },
        }
      })
      return compileAndAlignCurrentFrame(state, stateKeyframes)
    }),
    /**
     * 修改某张状态关键帧的拍摄机位（重要记录 005）。重编译是必须的：机位变化可能触发或解除
     * 与相邻卡之间的强制硬切（buildStateKeyframeTimeline 的有效过渡时长会随之变化）。
     */
    updateStateKeyframeCamera: (id, cameraId) => set((state) => {
      const stateKeyframes = state.stateKeyframes.map((stateKeyframe) => stateKeyframe.id === id ? { ...stateKeyframe, cameraId } : stateKeyframe)
      logger.debug('更新状态关键帧拍摄机位', {
        event: 'state_keyframe.stateKeyframe.camera_updated',
        stateKeyframeId: id,
        cameraId,
      })
      return { stateKeyframes, animation: compile(stateKeyframes, state.objects) }
    }),
    updateStateKeyframeContinuity: (id, continuity) => set((state) => {
      const stateKeyframes = state.stateKeyframes.map((stateKeyframe) => stateKeyframe.id === id ? { ...stateKeyframe, continuity } : stateKeyframe)
      return { stateKeyframes, animation: compile(stateKeyframes, state.objects) }
    }),
    captureIntoSelectedStateKeyframe: (objectIds) => set((state) => {
      if (state.playback.playing || !state.selectedStateKeyframeId) return {}
      if (!canCaptureAtCurrentTime(state)) {
        const inserted = insertCapturedStateKeyframe(state, state.objects)
        return {
          stateKeyframes: inserted.stateKeyframes,
          selectedStateKeyframeId: inserted.stateKeyframe.id,
          animation: compile(inserted.stateKeyframes, state.objects),
        }
      }
      const stateKeyframes = captureObjectsIntoStateKeyframe(state.stateKeyframes, state.selectedStateKeyframeId, state.objects, objectIds)
      return stateKeyframes === state.stateKeyframes ? {} : { stateKeyframes, animation: compile(stateKeyframes, state.objects) }
    }),
  }
}

export type StateKeyframeTimingPatch = Partial<Pick<StageStateKeyframe, 'hold' | 'transitionDuration'>>
export interface StateKeyframeTransitionPatch {
  perObject?: Record<string, StageStateKeyframeTransitionObjectDetail>
}
