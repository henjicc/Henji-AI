/**
 * 快照差异编译器（纯函数，禁止 UI/three/store 依赖）。
 *
 * 把镜头卡序列（StageShot[]，简易模式"全场景状态快照 + 停留 + 过渡"数据）编译成
 * 现有关键帧动画结构 StageSceneAnimation，复用 animatableProps 注册表定位轨道路径、
 * keyframeEngine 的 upsertKeyframe 做同点去重，采样/播放/导出链路零改动。
 *
 * 核心流程：时间轴布点 → 逐对象逐属性差异检测（带容差）→ 生成过渡两端关键帧
 * （速度预设映射缓动、错峰延迟钳制起止时间、停留段补同值守护点防止跨卡插值污染）。
 *
 * 扩展点（1.3/1.4 在本文件基础上扩展，不改变整体结构）：
 * - 摄像机运镜预设：见 compileTransitionPoints 内 TODO(1.3)。
 * - 角色自动走跑：见 compileObjectTransition 内 TODO(1.4)。
 */

import { listAnimatableGroups } from './animatableProps'
import {
  CAMERA_STAGE_DEFAULT_FPS,
  type StageAnimatableValueType,
  type StageEasingPreset,
  type StageKeyframe,
  type StageKeyframeValue,
  type StageSceneAnimation,
  type StageTrack,
} from './animationTypes'
import { upsertKeyframe } from './keyframeEngine'
import type { StageObject } from './sceneTypes'
import type { StageCameraMove, StageShot, StageShotObjectState, StageSpeedPreset } from './shotTypes'

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

interface ShotTimelineSegment {
  holdStart: number
  /** 过渡开始（= 停留结束） */
  transitionStart: number
  /** 过渡结束；末卡等于 transitionStart（无过渡） */
  transitionEnd: number
}

/** 顺序累加 hold + transitionDuration 得每张卡的停留/过渡时间点；末卡只算 hold */
function buildShotTimeline(shots: StageShot[]): ShotTimelineSegment[] {
  const timeline: ShotTimelineSegment[] = []
  let cursor = 0
  shots.forEach((shot, index) => {
    const holdStart = cursor
    const transitionStart = holdStart + Math.max(0, shot.hold)
    const isLast = index === shots.length - 1
    const transitionEnd = isLast ? transitionStart : transitionStart + Math.max(0, shot.transitionDuration)
    timeline.push({ holdStart, transitionStart, transitionEnd })
    cursor = transitionEnd
  })
  return timeline
}

/** 把镜头卡快照的可动画字段合并进当前场景对象，复用 animatableProps 的取值逻辑而不重写一份 */
function mergeStateIntoObject(object: StageObject, state: StageShotObjectState): StageObject {
  if (object.type === 'camera') {
    return {
      ...object,
      transform: state.transform,
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

/**
 * 生成某属性在本段过渡的关键帧点（过渡开始/结束两点）。
 *
 * TODO(1.3)：当 object 是摄像机且本段 cameraMoves[cameraId].kind !== 'direct' 时，
 * 应改为调用运镜预设编译函数（orbit/dollyIn/dollyOut），返回多点关键帧近似运镜轨迹，
 * 而不是这里的两点直插；建议只对 transform.position 分组的路径生效，fov/color 等其他
 * 属性仍走本函数的直插逻辑。object/move 两个参数当前未使用，是特意保留给 1.3 在此函数
 * 内部做分支判断用的（避免 1.3 改签名时还要在调用处重新传参）。建议签名：
 *   function compileCameraMovePreset(
 *     move: Exclude<StageCameraMove, { kind: 'direct' }>,
 *     fromValue: StageKeyframeValue, toValue: StageKeyframeValue,
 *     segStart: number, segEnd: number, easing: StageEasingPreset,
 *   ): StageKeyframe[]
 * 当前占位：不区分 move.kind，一律按 direct 两点插值（1.3 完成前的安全默认行为）。
 */
function compileTransitionPoints(
  object: StageObject,
  move: StageCameraMove | undefined,
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
 * StageShotObjectState.motion / transition.perObject[id].motionOverride 的时间表落点
 * （何时切换到走跑动画、何时切回 motion 快照）尚未定稿（见 handoff.md 重要记录 002），
 * 1.4 需要在这里（或旁路结构）补上 object.type === 'character' 时的动作推断与写入。
 */
function compileObjectTransition(
  trackMap: TrackMap,
  object: StageObject,
  fromState: StageShotObjectState,
  toState: StageShotObjectState,
  move: StageCameraMove | undefined,
  segStart: number,
  segEnd: number,
  easing: StageEasingPreset,
  holdGuard: HoldGuard,
): void {
  const fromObject = mergeStateIntoObject(object, fromState)
  const toObject = mergeStateIntoObject(object, toState)

  for (const group of listAnimatableGroups(object)) {
    for (const descriptor of group.children) {
      const fromValue = descriptor.getValue(fromObject)
      const toValue = descriptor.getValue(toObject)
      if (!hasPropertyChanged(descriptor.valueType, fromValue, toValue)) continue

      const points = compileTransitionPoints(object, move, fromValue, toValue, segStart, segEnd, easing)
      for (const point of points) {
        writeKeyframe(trackMap, object.id, descriptor.path, point)
      }
      if (holdGuard.enabled) {
        writeKeyframe(trackMap, object.id, descriptor.path, { time: holdGuard.time, value: toValue, easing: 'linear' })
      }
    }
  }
}

function finalizeTracks(trackMap: TrackMap): StageTrack[] {
  const tracks: StageTrack[] = []
  for (const [key, keyframes] of trackMap) {
    const separatorIndex = key.indexOf(TRACK_KEY_SEPARATOR)
    tracks.push({
      objectId: key.slice(0, separatorIndex),
      propertyPath: key.slice(separatorIndex + TRACK_KEY_SEPARATOR.length),
      keyframes,
    })
  }
  return tracks
}

/**
 * 把镜头卡序列编译成场景动画（纯函数，无副作用）。
 *
 * @param shots 镜头卡序列（按时间顺序）；空数组返回空轨道、duration=0
 * @param objects 当前场景对象列表：用于取可动画属性分组与结构字段，属性取值以镜头卡快照为准
 */
export function compileShotsToAnimation(shots: StageShot[], objects: StageObject[]): StageSceneAnimation {
  if (shots.length === 0) {
    return { tracks: [], duration: 0, fps: CAMERA_STAGE_DEFAULT_FPS }
  }

  const timeline = buildShotTimeline(shots)
  const duration = timeline[timeline.length - 1].transitionEnd
  const trackMap: TrackMap = new Map()

  for (let i = 0; i < shots.length - 1; i += 1) {
    const fromShot = shots[i]
    const toShot = shots[i + 1]
    const seg = timeline[i]
    const nextSeg = timeline[i + 1]
    const holdGuard: HoldGuard = {
      enabled: i + 1 < shots.length - 1 && toShot.hold > 0,
      time: nextSeg.transitionStart,
    }

    for (const object of objects) {
      const fromState = fromShot.objectStates[object.id]
      const toState = toShot.objectStates[object.id]
      if (!fromState || !toState) continue

      const detail = fromShot.transition.perObject[object.id]
      const easing = resolveSpeedPresetEasing(detail?.speedPreset)
      const [segStart, segEnd] = applyTransitionDelay(seg.transitionStart, seg.transitionEnd, detail?.delay ?? 0)
      const move = object.type === 'camera' ? fromShot.transition.cameraMoves[object.id] : undefined

      compileObjectTransition(trackMap, object, fromState, toState, move, segStart, segEnd, easing, holdGuard)
    }
  }

  return { tracks: finalizeTracks(trackMap), duration, fps: CAMERA_STAGE_DEFAULT_FPS }
}
