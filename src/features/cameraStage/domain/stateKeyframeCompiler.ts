/**
 * 快照差异编译器（纯函数，禁止 UI/three/store 依赖）。
 *
 * 把状态关键帧序列（StageStateKeyframe[]，全场景状态快照 + 停留 + 过渡）编译成
 * 现有关键帧动画结构 StageSceneAnimation，复用 animatableProps 注册表定位轨道路径、
 * keyframeEngine 的 upsertKeyframe 做同点去重，采样/播放/导出链路零改动。
 *
 * 核心流程：时间轴布点 → 逐对象逐属性差异检测（带容差）→ 生成过渡两端关键帧
 * （速度预设映射缓动、错峰延迟钳制起止时间、停留段补同值守护点防止跨卡插值污染）。
 *
 * 扩展点（1.3/1.4 在本文件基础上扩展，不改变整体结构）：
 * - 摄像机运镜预设在写入状态关键帧时物化为 StageSpatialPath，本编译器只消费可见路径
 *   （几何实现在 stateKeyframeCameraMovePresets.ts）。
 * - 角色自动走跑：见 compileObjectTransition 内 TODO(1.4)。
 */

import { listAnimatableGroups } from './animatableProps'
import { getObjectLookAtPoint } from './cameraUtils'
import {
  CAMERA_STAGE_DEFAULT_FPS,
  type StageAnimatableValueType,
  type StageEasingPreset,
  type StageKeyframe,
  type StageKeyframeValue,
  type StageCharacterMotionScheduleEntry,
  type StageSceneAnimation,
  type StageTrack,
} from './animationTypes'
import { upsertKeyframe } from './keyframeEngine'
import type { StageObject, StageVec3 } from './sceneTypes'
import { rotationFromPositionAndTarget } from './cameraUtils'
import { inferCharacterTransition } from './characterTransitionInference'
import { compileSpatialPathSamples } from './spatialPath'
import type { StageStateKeyframe, StageStateKeyframeObjectState, StageSpatialPath, StageSpeedPreset } from './stateKeyframeTypes'

/** scalar 属性差异容差：|a-b| 不超过该值视为未变化 */
const SCALAR_EPSILON = 1e-3

const SPEED_PRESET_EASING: Record<StageSpeedPreset, StageEasingPreset> = {
  uniform: 'linear',
  easeInOut: 'easeInOut',
  fastStart: 'easeOut',
  slowStart: 'easeIn',
}

/** 速度预设 → 缓动映射；未指定时默认 easeInOut */
function resolveSpeedPresetEasing(preset: StageSpeedPreset | undefined): StageEasingPreset {
  return SPEED_PRESET_EASING[preset ?? 'easeInOut']
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** 按对象错峰延迟平移过渡起止时间，钳制在原过渡区间内（压缩而非越界） */
function applyTransitionDelay(transitionStart: number, transitionEnd: number, delay: number): [number, number] {
  const start = clamp(transitionStart + delay, transitionStart, transitionEnd)
  const end = clamp(transitionEnd + delay, transitionStart, transitionEnd)
  return [start, end]
}

export interface StateKeyframeTimelineSegment {
  holdStart: number
  /** 过渡开始（= 停留结束） */
  transitionStart: number
  /** 过渡结束；末卡等于 transitionStart（无过渡） */
  transitionEnd: number
}

/**
 * 相邻两卡是否均已指定机位且机位不同（重要记录 005：多机位强制硬切）。
 * 只要有一侧未指定机位（cameraId 为 null，沿用全局值），就不视为"机位不同"，
 * 因为此时无法确定该段实际是否跨机位——保持与改动前一致的行为，避免旧工程/单机位工程误判。
 * 导出供 UI 层（3.2 过渡块/气泡的跨机位硬切呈现）复用，不另起一套判断。
 */
export function hasForcedHardCut(current: StageStateKeyframe, next: StageStateKeyframe): boolean {
  return !!current.cameraId && !!next.cameraId && current.cameraId !== next.cameraId
}

/**
 * 顺序累加 hold + 过渡时长得到每枚状态关键帧的停留/过渡时间点；末点只算 hold。
 * 相邻两卡机位不同时，该段过渡的"有效时长"在这里被视为 0（强制硬切，重要记录 005）；
 * `stateKeyframe.transitionDuration` 本身不被改写，机位改回相同后布点自动恢复原时长。
 */
export function buildStateKeyframeTimeline(stateKeyframes: StageStateKeyframe[]): StateKeyframeTimelineSegment[] {
  // 旧工程可能仍带有 hold；在保存迁移完成前继续按旧时长还原绝对点位，避免打开后节奏突变。
  const needsLegacyTiming = stateKeyframes.some((stateKeyframe) => stateKeyframe.hold > 0)
    || stateKeyframes.some((stateKeyframe, index) => index > 0 && stateKeyframe.time <= stateKeyframes[index - 1].time)
  if (needsLegacyTiming) {
    let cursor = 0
    return stateKeyframes.map((stateKeyframe, index) => {
      const holdStart = cursor
      const transitionStart = holdStart + Math.max(0, stateKeyframe.hold)
      const transitionEnd = index === stateKeyframes.length - 1
        ? transitionStart
        : transitionStart + Math.max(0, stateKeyframe.transitionDuration)
      cursor = transitionEnd
      return { holdStart, transitionStart, transitionEnd }
    })
  }
  return stateKeyframes.map((stateKeyframe, index) => {
    const time = Math.max(0, stateKeyframe.time)
    const nextTime = stateKeyframes[index + 1] ? Math.max(time, stateKeyframes[index + 1].time) : time
    return { holdStart: time, transitionStart: time, transitionEnd: nextTime }
  })
}

/** object 模式的注视点：优先取目标物体的实时位置，目标不存在时才退回快照坐标。 */
function resolveLiveLookAtTarget(
  lookAt: StageStateKeyframeObjectState['lookAt'],
  objects: StageObject[],
): StageVec3 {
  if (!lookAt || lookAt.mode === 'manual') return { x: 0, y: 0, z: 0 }
  const target = objects.find((item) => item.id === lookAt.objectId)
  return target ? getObjectLookAtPoint(target) : { ...lookAt.fallbackTarget }
}

/** 把状态关键帧快照的可动画字段合并进当前场景对象，复用 animatableProps 的取值逻辑而不重写一份 */
function mergeStateIntoObject(
  object: StageObject,
  state: StageStateKeyframeObjectState,
  objects: StageObject[] = [],
): StageObject {
  if (object.type === 'camera') {
    /*
     * object 模式必须盯**物体的实时位置**，不是 fallbackTarget。
     *
     * fallbackTarget 是做运镜那一刻的坐标快照，只在目标对象已被删除时才该用。旧实现无条件
     * 取它，于是目标物体一旦移动（或者场景里新增了对象把视觉中心挪开），编译出来的每一帧
     * 都还盯着旧坐标——实测环绕运镜跑到一半，镜头明显偏出物体之外。
     *
     * cameraUtils.resolveCameraRotation 早就是按实时目标解朝向的；编译器这条是同一件事漏掉
     * 的另一半，两处必须一致，否则视口里看着对、播放出来是歪的。
     */
    const lookAtTarget = state.lookAt?.mode === 'manual'
      ? state.lookAt.target
      : resolveLiveLookAtTarget(state.lookAt, objects)
    return {
      ...object,
      transform: {
        ...state.transform,
        rotation: rotationFromPositionAndTarget(
          state.transform.position,
          lookAtTarget,
          state.transform.rotation.z,
        ),
      },
      color: state.color,
      fov: state.fov ?? object.fov,
      lookAt: state.lookAt ?? object.lookAt,
    }
  }
  if (object.type === 'character') {
    return {
      ...object,
      transform: state.transform,
      color: state.color,
      pose: state.pose ?? object.pose,
      motion: state.motion ?? object.motion,
    }
  }
  return { ...object, transform: state.transform, color: state.color }
}

function hasPropertyChanged(valueType: StageAnimatableValueType, a: StageKeyframeValue, b: StageKeyframeValue): boolean {
  if (valueType === 'color') return a !== b
  return Math.abs((a as number) - (b as number)) > SCALAR_EPSILON
}

/** 欧拉角等价值解包到离起点最近的一圈，避免 170° → -170° 绕远路旋转 340°。 */
function unwrapNearestAngle(from: number, to: number): number {
  const delta = ((to - from + 180) % 360 + 360) % 360 - 180
  return from + delta
}

/** 返回两张状态关键帧之间确有可动画属性变化的对象 id；UI 与编译器共享同一注册表和差异容差。 */
export function diffStateKeyframeObjects(fromStateKeyframe: StageStateKeyframe, toStateKeyframe: StageStateKeyframe, objects: StageObject[]): string[] {
  const changedObjectIds: string[] = []
  for (const object of objects) {
    const fromState = fromStateKeyframe.objectStates[object.id]
    const toState = toStateKeyframe.objectStates[object.id]
    if (!fromState || !toState) continue
    const fromObject = mergeStateIntoObject(object, fromState, objects)
    const toObject = mergeStateIntoObject(object, toState, objects)
    const changed = listAnimatableGroups(object).some((group) => group.children.some((descriptor) => (
      hasPropertyChanged(descriptor.valueType, descriptor.getValue(fromObject), descriptor.getValue(toObject))
    )))
    if (changed) changedObjectIds.push(object.id)
  }
  return changedObjectIds
}

/** 生成普通属性在本段过渡的起止关键帧；空间路径在位置分组入口单独编译。 */
function compileTransitionPoints(
  fromValue: StageKeyframeValue,
  toValue: StageKeyframeValue,
  segStart: number,
  segEnd: number,
  easing: StageEasingPreset,
): StageKeyframe[] {
  return [
    { time: segStart, value: fromValue, easing },
    { time: segEnd, value: toValue, easing: 'linear' },
  ]
}

function compileSpatialPositionGroup(
  trackMap: TrackMap,
  objectId: string,
  fromPosition: StageVec3,
  toPosition: StageVec3,
  path: StageSpatialPath,
  segStart: number,
  segEnd: number,
  easing: StageEasingPreset,
  holdGuard: HoldGuard,
): void {
  const samples = compileSpatialPathSamples(fromPosition, toPosition, path, segStart, segEnd, easing)
  for (const axis of ['x', 'y', 'z'] as const) {
    const propertyPath = `transform.position.${axis}`
    for (const sample of samples) {
      writeKeyframe(trackMap, objectId, propertyPath, {
        time: sample.time,
        value: sample.position[axis],
        easing: 'linear',
        // 空间切线已完整定义几何形状，禁止通用 continuity Hermite 再次改写采样曲线。
        continuity: 'stop',
      })
    }
    if (holdGuard.enabled) {
      writeKeyframe(trackMap, objectId, propertyPath, { time: holdGuard.time, value: toPosition[axis], easing: 'linear' })
    }
  }
}

type TrackMap = Map<string, StageKeyframe[]>

const TRACK_KEY_SEPARATOR = '::'

function trackKey(objectId: string, propertyPath: string): string {
  return `${objectId}${TRACK_KEY_SEPARATOR}${propertyPath}`
}

/** 写入一个关键帧点，同轨道同时间（±KEYFRAME_TIME_EPSILON）只保留后写入的点（复用 upsertKeyframe） */
function writeKeyframe(trackMap: TrackMap, objectId: string, propertyPath: string, keyframe: StageKeyframe): void {
  const key = trackKey(objectId, propertyPath)
  const existing = trackMap.get(key) ?? []
  trackMap.set(key, upsertKeyframe(existing, keyframe))
}

interface HoldGuard {
  enabled: boolean
  time: number
}

/**
 * 编译单个对象在一段过渡内变化的属性，写入 trackMap。
 *
 * TODO(1.4)：角色自动走跑/朝向推断钩子。当前仅做逐属性差异直插，不推断"走/跑"动作；
 * StageStateKeyframeObjectState.motion / transition.perObject[id].motionOverride 的时间表落点
 * （何时切换到走跑动画、何时切回 motion 快照）尚未定稿（见 handoff.md 重要记录 002），
 * 1.4 需要在这里（或旁路结构）补上 object.type === 'character' 时的动作推断与写入。
 */
function compileObjectTransition(
  trackMap: TrackMap,
  object: StageObject,
  fromState: StageStateKeyframeObjectState,
  toState: StageStateKeyframeObjectState,
  segStart: number,
  segEnd: number,
  easing: StageEasingPreset,
  holdGuard: HoldGuard,
  motionSchedule?: StageCharacterMotionScheduleEntry[],
  motionOverride?: import('./characterMotion').StageCharacterMotion,
  spatialPath?: StageSpatialPath,
  /** 场景全部对象，用于把 object 模式的注视点解析成目标物体的实时位置。 */
  sceneObjects: StageObject[] = [],
): void {
  const fromObject = mergeStateIntoObject(object, fromState, sceneObjects)
  const toObject = mergeStateIntoObject(object, toState, sceneObjects)
  const characterInference = object.type === 'character'
    ? inferCharacterTransition(fromState, toState, segEnd - segStart, motionOverride)
    : null

  if (characterInference?.motion && motionSchedule) {
    motionSchedule.push({
      objectId: object.id,
      startTime: segStart,
      endTime: segEnd,
      motion: characterInference.motion,
      afterMotion: toState.motion ?? (object.type === 'character' ? object.motion : { mode: 'pose' }),
    })
    for (const point of characterInference.facingYawKeyframes) {
      writeKeyframe(trackMap, object.id, 'transform.rotation.y', {
        time: segStart + (segEnd - segStart) * point.timeRatio,
        value: point.yaw,
        easing: 'easeInOut',
      })
    }
    if (holdGuard.enabled) {
      const targetYaw = characterInference.facingYawKeyframes[characterInference.facingYawKeyframes.length - 1]?.yaw
        ?? toState.transform.rotation.y
      writeKeyframe(trackMap, object.id, 'transform.rotation.y', {
        time: holdGuard.time,
        value: targetYaw,
        easing: 'linear',
      })
    }
  }

  for (const group of listAnimatableGroups(object)) {
    if (group.groupPath === 'transform.position' && spatialPath) {
      compileSpatialPositionGroup(
        trackMap,
        object.id,
        fromState.transform.position,
        toState.transform.position,
        spatialPath,
        segStart,
        segEnd,
        easing,
        holdGuard,
      )
      continue
    }
    for (const descriptor of group.children) {
      if (characterInference?.motion && descriptor.path === 'transform.rotation.y') continue
      const fromValue = descriptor.getValue(fromObject)
      const rawToValue = descriptor.getValue(toObject)
      const toValue = object.type === 'camera'
        && descriptor.path.startsWith('transform.rotation.')
        && typeof fromValue === 'number'
        && typeof rawToValue === 'number'
        ? unwrapNearestAngle(fromValue, rawToValue)
        : rawToValue
      if (!hasPropertyChanged(descriptor.valueType, fromValue, toValue)) continue

      const points = compileTransitionPoints(fromValue, toValue, segStart, segEnd, easing)
      for (const point of points) {
        writeKeyframe(trackMap, object.id, descriptor.path, point)
      }
      if (holdGuard.enabled) {
        writeKeyframe(trackMap, object.id, descriptor.path, { time: holdGuard.time, value: toValue, easing: 'linear' })
      }
    }
  }
}

function finalizeTracks(trackMap: TrackMap, stateKeyframes: StageStateKeyframe[]): StageTrack[] {
  const tracks: StageTrack[] = []
  for (const [key, keyframes] of trackMap) {
    const separatorIndex = key.indexOf(TRACK_KEY_SEPARATOR)
    tracks.push({
      objectId: key.slice(0, separatorIndex),
      propertyPath: key.slice(separatorIndex + TRACK_KEY_SEPARATOR.length),
      keyframes: keyframes.map((keyframe) => {
        const stateKeyframe = stateKeyframes.find((item) => Math.abs(item.time - keyframe.time) <= 1e-4)
        return stateKeyframe && keyframe.continuity === undefined ? { ...keyframe, continuity: stateKeyframe.continuity } : keyframe
      }),
    })
  }
  return tracks
}

/**
 * 把状态关键帧序列编译成场景动画（纯函数，无副作用）。
 *
 * @param stateKeyframes 状态关键帧序列（按时间顺序）；空数组返回空轨道、duration=0
 * @param objects 当前场景对象列表：用于取可动画属性分组与结构字段，属性取值以状态关键帧快照为准
 */
export function compileStateKeyframesToAnimation(stateKeyframes: StageStateKeyframe[], objects: StageObject[]): StageSceneAnimation {
  if (stateKeyframes.length === 0) {
    return { tracks: [], motionSchedule: [], duration: 0, fps: CAMERA_STAGE_DEFAULT_FPS }
  }

  const timeline = buildStateKeyframeTimeline(stateKeyframes)
  const duration = timeline[timeline.length - 1].transitionEnd
  const trackMap: TrackMap = new Map()
  const motionSchedule: StageCharacterMotionScheduleEntry[] = []

  for (let i = 0; i < stateKeyframes.length - 1; i += 1) {
    const fromStateKeyframe = stateKeyframes[i]
    const toStateKeyframe = stateKeyframes[i + 1]
    const seg = timeline[i]
    const holdGuard: HoldGuard = { enabled: false, time: seg.transitionEnd }

    for (const object of objects) {
      const fromState = fromStateKeyframe.objectStates[object.id]
      const toState = toStateKeyframe.objectStates[object.id]
      if (!fromState || !toState) continue

      const detail = fromStateKeyframe.transition.perObject[object.id]
      const easing = hasForcedHardCut(fromStateKeyframe, toStateKeyframe)
        ? 'hold'
        : resolveSpeedPresetEasing(detail?.speedPreset)
      const [segStart, segEnd] = applyTransitionDelay(seg.transitionStart, seg.transitionEnd, detail?.delay ?? 0)
      compileObjectTransition(
        trackMap,
        object,
        fromState,
        toState,
        segStart,
        segEnd,
        easing,
        holdGuard,
        motionSchedule,
        detail?.motionOverride,
        detail?.spatialPath,
        objects,
      )
    }
  }

  return { tracks: finalizeTracks(trackMap, stateKeyframes), motionSchedule, duration, fps: CAMERA_STAGE_DEFAULT_FPS }
}
