import type { StoreApi } from 'zustand'
import { createLogger } from '@/core/logging'
import { compileStateKeyframesToAnimation } from '../domain/stateKeyframeCompiler'
import {
  captureStateKeyframeObjectState,
  createStateKeyframe,
  type StageCameraMovePreset,
  type StageStateKeyframe,
  type StageSpatialPath,
  type StageStateKeyframeObjectState,
  type StageStateKeyframeTransitionObjectDetail,
} from '../domain/stateKeyframeTypes'
import type { StageCameraLookAt, StageObject, StageObjectPatch, StageVec3 } from '../domain/sceneTypes'
import { isCameraId } from '../domain/cameraUtils'
import { createCameraPresetPath } from '../domain/spatialPath'
import { markSpatialPathCustom } from '../domain/spatialPath'
import { clampTransition, isTimeInStateKeyframeStaticSegment, quantizeToFrame } from '../stateKeyframes/timeline/stateKeyframeClipGeometry'
import type { CameraStageState } from './cameraStageStore'
import { cameraLiveAt } from './cameraCutSlice'
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

export function compileAndAlignCurrentFrame(
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

/**
 * 采样值不是作者值，逐分量写回：
 * - 与采样值相同的分量只是动画求出来的结果，保留卡里原值；
 * - 位置改过的分量按“卡里原值 +（这次的值 − 采样值）”写：平滑衔接卡上看到的是切圆后的位置，
 *   在它上面拖了一段，就只把这段增量加到原机位上，不会把切圆后的位置整个写进卡；
 * - 其余分量（旋转、缩放、视野、颜色）改过就照写新值。摄像机注视区间的旋转由注视点求出，卡里的旋转
 *   不参与画面，按增量换算没有意义；手动转镜头时写的就是要的角度。
 * 没被动画驱动的分量采样值就是卡里的值，结果即这次的值。
 */
function rebaseOnStored(
  stored: StageStateKeyframeObjectState,
  captured: StageStateKeyframeObjectState,
  sampled: StageStateKeyframeObjectState,
): StageStateKeyframeObjectState {
  const vector = (key: keyof StageStateKeyframeObjectState['transform'], shift: boolean): StageVec3 => {
    const component = (axis: keyof StageVec3): number => {
      const value = captured.transform[key][axis]
      const reference = sampled.transform[key][axis]
      const original = stored.transform[key][axis]
      if (value === reference) return original
      // 采样值就是原值时直接取这次的值，免得加减带进浮点尾差。
      return shift && reference !== original ? original + (value - reference) : value
    }
    return { x: component('x'), y: component('y'), z: component('z') }
  }
  return {
    ...captured,
    transform: { position: vector('position', true), rotation: vector('rotation', false), scale: vector('scale', false) },
    color: captured.color === sampled.color ? stored.color : captured.color,
    ...(captured.fov !== undefined && captured.fov === sampled.fov && stored.fov !== undefined ? { fov: stored.fov } : {}),
  }
}

/**
 * 把对象当前状态写进一张状态关键帧。
 *
 * sampled 是当前编译产物在这张卡时刻的采样结果（播放头正停在这张卡上时才传）。平滑衔接的拐角被切圆、
 * 注视跟随有滞后，采样出的机位与朝向不再等于卡里存的值；不加区分地写回，每写一次卡就往拐角内侧漂一次。
 * 所以按 rebaseOnStored 逐分量区分：没改过的保留原值，改过的才写进去。
 */
export function captureObjectsIntoStateKeyframe(
  stateKeyframes: StageStateKeyframe[],
  selectedStateKeyframeId: string | null,
  objects: StageObject[],
  objectIds?: string[],
  sampled?: readonly StageObject[],
): StageStateKeyframe[] {
  if (!selectedStateKeyframeId) return stateKeyframes
  const allowedIds = objectIds ? new Set(objectIds) : null
  const sampledById = sampled ? new Map(sampled.map((object) => [object.id, object])) : null
  return stateKeyframes.map((stateKeyframe) => {
    if (stateKeyframe.id !== selectedStateKeyframeId) return stateKeyframe
    const objectStates = { ...stateKeyframe.objectStates }
    for (const object of objects) {
      if (allowedIds && !allowedIds.has(object.id)) continue
      const captured = captureStateKeyframeObjectState(object)
      const stored = objectStates[object.id]
      const sampledObject = sampledById?.get(object.id)
      objectStates[object.id] = stored && sampledObject
        ? rebaseOnStored(stored, captured, captureStateKeyframeObjectState(sampledObject))
        : captured
    }
    return { ...stateKeyframe, objectStates }
  })
}

/**
 * 播放头正停在这张状态关键帧上时，从卡快照出发、按当前编译产物在该时刻采样的结果；否则为 undefined
 * （写入就是有意把当前状态记进去）。从卡快照出发：没有轨道驱动的分组采样出来就是卡里的值，
 * 实时改过它就与采样值不同，照常写入；只有被动画驱动、且与采样值相同的分组才算“播放出来的值”。
 */
export function sampledAtStateKeyframe(state: CameraStageState, stateKeyframeId: string | null): StageObject[] | undefined {
  const stateKeyframe = state.stateKeyframes.find((item) => item.id === stateKeyframeId)
  if (!stateKeyframe || Math.abs(stateKeyframe.time - state.playback.currentTime) > 0.5 / Math.max(1, state.animation.fps)) return undefined
  return applyAnimationAtTime(applyStateKeyframeToObjects(state.objects, stateKeyframe), state.animation, stateKeyframe.time)
}

export function syncAddedObjectToStateKeyframes(stateKeyframes: StageStateKeyframe[], object: StageObject): StageStateKeyframe[] {
  const snapshot = captureStateKeyframeObjectState(object)
  return stateKeyframes.map((stateKeyframe) => ({ ...stateKeyframe, objectStates: { ...stateKeyframe.objectStates, [object.id]: snapshot } }))
}

function sameVec3(a: StageVec3, b: StageVec3): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z
}

/**
 * 建模写入（助手、批量写入）同步进全部状态关键帧：只写这次改到的可动画字段，其余字段保留各状态关键帧自己的值。
 * 整份快照覆盖会把对象在其他时间点的位置一并抹平——改个注视点或名称，整段运镜就没了。
 * 变换按位置、旋转、缩放三组比较，没变的组不动。状态关键帧里还没有这个对象时补完整快照。
 */
export function syncObjectPatchAcrossStateKeyframes(
  stateKeyframes: StageStateKeyframe[],
  before: StageObject,
  after: StageObject,
  patch: StageObjectPatch,
): StageStateKeyframe[] {
  const snapshot = captureStateKeyframeObjectState(after)
  const transformGroups = patch.transform
    ? (['position', 'rotation', 'scale'] as const).filter((group) => !sameVec3(before.transform[group], after.transform[group]))
    : []
  return stateKeyframes.map((stateKeyframe) => {
    const existing = stateKeyframe.objectStates[after.id]
    if (!existing) return { ...stateKeyframe, objectStates: { ...stateKeyframe.objectStates, [after.id]: snapshot } }
    const next: StageStateKeyframeObjectState = { ...existing, transform: { ...existing.transform } }
    for (const group of transformGroups) next.transform[group] = { ...snapshot.transform[group] }
    if (patch.color !== undefined) next.color = snapshot.color
    if (patch.fov !== undefined) next.fov = snapshot.fov
    if (patch.lookAt !== undefined) next.lookAt = structuredClone(snapshot.lookAt)
    if (patch.pose !== undefined) next.pose = snapshot.pose
    if (patch.motion !== undefined) next.motion = snapshot.motion
    return { ...stateKeyframe, objectStates: { ...stateKeyframe.objectStates, [after.id]: next } }
  })
}

/**
 * 一次性替换一批对象在全部状态关键帧里的快照（布景生成与删除用）：先去掉 removedIds，再写入 added。
 * 逐个调用单对象版本时每次都要复制整张 objectStates，上万个对象就是平方级。
 */
export function replaceObjectsInStateKeyframes(
  stateKeyframes: StageStateKeyframe[],
  removedIds: ReadonlySet<string>,
  added: readonly StageObject[],
): StageStateKeyframe[] {
  const snapshots = added.map((object) => [object.id, captureStateKeyframeObjectState(object)] as const)
  return stateKeyframes.map((stateKeyframe) => {
    const objectStates: StageStateKeyframe['objectStates'] = {}
    for (const [id, state] of Object.entries(stateKeyframe.objectStates)) if (!removedIds.has(id)) objectStates[id] = state
    for (const [id, state] of snapshots) objectStates[id] = state
    const perObject: StageStateKeyframe['transition']['perObject'] = {}
    for (const [id, detail] of Object.entries(stateKeyframe.transition.perObject)) if (!removedIds.has(id)) perObject[id] = detail
    return { ...stateKeyframe, objectStates, transition: { ...stateKeyframe.transition, perObject } }
  })
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
  // 给这一段指定了路径就是不再跟拍：跟拍会盖住路径。
  if (path) {
    detail.spatialPath = path
    delete detail.follow
  } else delete detail.spatialPath
  return {
    ...stateKeyframe,
    transition: {
      perObject: { ...stateKeyframe.transition.perObject, [objectId]: detail },
    },
  }
}

/**
 * 在一段跟拍中间插卡时，新卡到下一张卡这一段接着跟拍（与上一段设置相同，编译时合成一段，滤波不断）。
 */
function inheritFollowAtInsert(stateKeyframes: StageStateKeyframe[], insertedId: string): StageStateKeyframe[] {
  const index = stateKeyframes.findIndex((stateKeyframe) => stateKeyframe.id === insertedId)
  const previous = stateKeyframes[index - 1]
  if (index <= 0 || !previous || index === stateKeyframes.length - 1) return stateKeyframes
  const follows = Object.entries(previous.transition.perObject).filter(([, detail]) => detail.follow)
  if (follows.length === 0) return stateKeyframes
  return stateKeyframes.map((stateKeyframe) => stateKeyframe.id !== insertedId ? stateKeyframe : {
    ...stateKeyframe,
    transition: { perObject: { ...stateKeyframe.transition.perObject, ...Object.fromEntries(follows.map(([objectId, detail]) => [objectId, { ...stateKeyframe.transition.perObject[objectId], follow: structuredClone(detail.follow) }])) } },
  })
}

/**
 * 作者在一张卡上动了摄像机（拖动、定机位、改注视），这张卡前后两段就不再跟拍：跟拍会盖住这次改动。
 */
export function endFollowAround(stateKeyframes: StageStateKeyframe[], stateKeyframeId: string | null, objectIds: readonly string[]): StageStateKeyframe[] {
  const index = stateKeyframes.findIndex((stateKeyframe) => stateKeyframe.id === stateKeyframeId)
  if (index < 0) return stateKeyframes
  const touched = new Set([index - 1, index])
  if (![...touched].some((at) => objectIds.some((id) => stateKeyframes[at]?.transition.perObject[id]?.follow))) return stateKeyframes
  return stateKeyframes.map((stateKeyframe, at) => {
    if (!touched.has(at) || !objectIds.some((id) => stateKeyframe.transition.perObject[id]?.follow)) return stateKeyframe
    const perObject = { ...stateKeyframe.transition.perObject }
    for (const id of objectIds) {
      if (!perObject[id]?.follow) continue
      const { follow: _follow, ...rest } = perObject[id]
      perObject[id] = rest
    }
    return { ...stateKeyframe, transition: { perObject } }
  })
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
    return { stateKeyframes: captureObjectsIntoStateKeyframe(state.stateKeyframes, existing.id, objects, undefined, sampledAtStateKeyframe(state, existing.id)), stateKeyframe: existing }
  }
  const stateKeyframe = createStateKeyframe(objects, `关键帧 ${state.stateKeyframes.length + 1}`, time)
  const stateKeyframes = inheritFollowAtInsert(syncTransitionDurations([...state.stateKeyframes, stateKeyframe].sort((a, b) => a.time - b.time)), stateKeyframe.id)
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
    const stateKeyframes = endFollowAround(inserted.stateKeyframes, inserted.stateKeyframe.id, reframedCameraIds(state.objects, objects, objectIds))
    return {
      objects,
      stateKeyframes,
      selectedStateKeyframeId: inserted.stateKeyframe.id,
      animation: compile(stateKeyframes, objects),
      // 状态关键帧按 fps 吸附；播放头必须在同一次 store 更新里落到完全相同的时间。
      // 否则重编译后的视口会继续以吸附前的小数时间采样，在新点旁边再次插值，
      // 用户开始拖动物体/相机的第一瞬间就会看到一次轻微跳变。
      playback: { ...state.playback, currentTime: inserted.stateKeyframe.time },
    }
  }
  const stateKeyframes = endFollowAround(captureObjectsIntoStateKeyframe(
    state.stateKeyframes, state.selectedStateKeyframeId, objects, objectIds, sampledAtStateKeyframe(state, state.selectedStateKeyframeId),
  ), state.selectedStateKeyframeId, reframedCameraIds(state.objects, objects, objectIds))
  return { objects, stateKeyframes, animation: compile(stateKeyframes, objects) }
}

/** 这次编辑真的挪了机位、转了镜头或换了注视点的摄像机；改名、改颜色、只按下没拖动都不算。 */
function reframedCameraIds(before: StageObject[], after: StageObject[], objectIds: readonly string[]): string[] {
  return objectIds.filter((id) => {
    const next = after.find((object) => object.id === id)
    const previous = before.find((object) => object.id === id)
    if (next?.type !== 'camera' || previous?.type !== 'camera') return false
    return JSON.stringify([previous.transform.position, previous.transform.rotation, previous.lookAt])
      !== JSON.stringify([next.transform.position, next.transform.rotation, next.lookAt])
  })
}

export function createStateKeyframeSlice(set: StoreApi<CameraStageState>['setState']): StateKeyframeSliceActions {
  return {
    addStateKeyframe: () => set((state) => {
      const time = quantizeToFrame(state.playback.currentTime, state.animation.fps)
      const existing = stateKeyframeAtTime(state.stateKeyframes, time, state.animation.fps)
      if (existing) {
        const stateKeyframes = captureObjectsIntoStateKeyframe(state.stateKeyframes, existing.id, state.objects, undefined, sampledAtStateKeyframe(state, existing.id))
        return { stateKeyframes, selectedStateKeyframeId: existing.id, animation: compile(stateKeyframes, state.objects) }
      }
      const stateKeyframe = createStateKeyframe(state.objects, `关键帧 ${state.stateKeyframes.length + 1}`, time)
      const stateKeyframes = inheritFollowAtInsert(syncTransitionDurations([...state.stateKeyframes, stateKeyframe].sort((a, b) => a.time - b.time)), stateKeyframe.id)
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
      // 选择状态关键帧 = 进入该时间点正在拍的机位编辑（显式用户动作，允许写 store）；
      // 那一刻没有切到某台摄像机，或机位指向已删除的对象时，activeCameraId 保持不变（不写入无效 id）。
      const shooting = cameraLiveAt(state.cameraCuts, time)
      const activeCameraId = isCameraId(state.objects, shooting) ? (shooting as string) : state.activeCameraId
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
     * 重复调用 selectStateKeyframe 只会多余地污染撤销历史。平滑衔接卡上的采样值可能不等于卡快照（拐角被切圆），
     * 写回时由 captureObjectsIntoStateKeyframe 按采样值区分，不会把采样值当成编辑写进去。
     */
    setSelectedStateKeyframeIdOnly: (id) => set((state) => {
      if (state.selectedStateKeyframeId === id) return {}
      return { selectedStateKeyframeId: id }
    }),
    updateStateKeyframeTiming: (id, patch) => set((state) => {
      const fps = state.animation.fps
      let stateKeyframes = state.stateKeyframes.map((stateKeyframe) => stateKeyframe.id === id ? {
        ...stateKeyframe,
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
      const stateKeyframes = captureObjectsIntoStateKeyframe(
        state.stateKeyframes, state.selectedStateKeyframeId, state.objects, objectIds, sampledAtStateKeyframe(state, state.selectedStateKeyframeId),
      )
      return stateKeyframes === state.stateKeyframes ? {} : { stateKeyframes, animation: compile(stateKeyframes, state.objects) }
    }),
  }
}

export type StateKeyframeTimingPatch = Partial<Pick<StageStateKeyframe, 'transitionDuration'>>
export interface StateKeyframeTransitionPatch {
  perObject?: Record<string, StageStateKeyframeTransitionObjectDetail>
}
