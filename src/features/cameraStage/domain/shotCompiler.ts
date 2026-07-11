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
 * - 摄像机运镜预设：已由 1.3 接入，见 compileCameraPositionGroup / compileCameraMoveSamples
 *   （几何实现在 shotCameraMovePresets.ts）。
 * - 角色自动走跑：见 compileObjectTransition 内 TODO(1.4)。
 */

import type { AnimatableGroup } from './animatableProps'
import { listAnimatableGroups } from './animatableProps'
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
import { compileCameraMoveSamples } from './shotCameraMovePresets'
import { inferCharacterTransition } from './characterTransitionInference'
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

export interface ShotTimelineSegment {
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
export function hasForcedHardCut(current: StageShot, next: StageShot): boolean {
  return !!current.cameraId && !!next.cameraId && current.cameraId !== next.cameraId
}

/**
 * 顺序累加 hold + 过渡时长得每张卡的停留/过渡时间点；末卡只算 hold。
 * 相邻两卡机位不同时，该段过渡的"有效时长"在这里被视为 0（强制硬切，重要记录 005）；
 * `shot.transitionDuration` 本身不被改写，机位改回相同后布点自动恢复原时长。
 */
export function buildShotTimeline(shots: StageShot[]): ShotTimelineSegment[] {
  // 旧工程可能仍带有 hold；在保存迁移完成前继续按旧时长还原绝对点位，避免打开后节奏突变。
  const needsLegacyTiming = shots.some((shot) => shot.hold > 0)
    || shots.some((shot, index) => index > 0 && shot.time <= shots[index - 1].time)
  if (needsLegacyTiming) {
    let cursor = 0
    return shots.map((shot, index) => {
      const holdStart = cursor
      const transitionStart = holdStart + Math.max(0, shot.hold)
      const transitionEnd = index === shots.length - 1
        ? transitionStart
        : transitionStart + Math.max(0, shot.transitionDuration)
      cursor = transitionEnd
      return { holdStart, transitionStart, transitionEnd }
    })
  }
  return shots.map((shot, index) => {
    const time = Math.max(0, shot.time)
    const nextTime = shots[index + 1] ? Math.max(time, shots[index + 1].time) : time
    return { holdStart: time, transitionStart: time, transitionEnd: nextTime }
  })
}

/** 把镜头卡快照的可动画字段合并进当前场景对象，复用 animatableProps 的取值逻辑而不重写一份 */
function mergeStateIntoObject(object: StageObject, state: StageShotObjectState): StageObject {
  if (object.type === 'camera') {
    const lookAtTarget = state.lookAt?.mode === 'manual'
      ? state.lookAt.target
      : state.lookAt?.fallbackTarget ?? { x: 0, y: 0, z: 0 }
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

/** 返回两张镜头卡之间确有可动画属性变化的对象 id；UI 与编译器共享同一注册表和差异容差。 */
export function diffShotObjects(fromShot: StageShot, toShot: StageShot, objects: StageObject[]): string[] {
  const changedObjectIds: string[] = []
  for (const object of objects) {
    const fromState = fromShot.objectStates[object.id]
    const toState = toShot.objectStates[object.id]
    if (!fromState || !toState) continue
    const fromObject = mergeStateIntoObject(object, fromState)
    const toObject = mergeStateIntoObject(object, toState)
    const changed = listAnimatableGroups(object).some((group) => group.children.some((descriptor) => (
      hasPropertyChanged(descriptor.valueType, descriptor.getValue(fromObject), descriptor.getValue(toObject))
    )))
    if (changed) changedObjectIds.push(object.id)
  }
  return changedObjectIds
}

function isCameraPositionAxisPath(propertyPath: string): boolean {
  return (
    propertyPath === 'transform.position.x' ||
    propertyPath === 'transform.position.y' ||
    propertyPath === 'transform.position.z'
  )
}

/**
 * 生成某属性在本段过渡的关键帧点（过渡开始/结束两点，direct 两点直插）。
 *
 * 1.3 说明（原 TODO 已解决）：摄像机运镜预设（orbit/dollyIn/dollyOut/truck/crane）需要
 * X/Y/Z 三分量整体的向量几何（如绕 Y 轴旋转、垂直视线方向平移），单分量 scalar 签名无法
 * 独立算出正确结果，因此实际拦截点不在本函数内部，而是在 compileObjectTransition 的
 * transform.position 分组循环入口（见 compileCameraPositionGroup），三分量一次性算出、
 * 一次性写入三条轨道。本函数保留 propertyPath 参数只做防御性校验：一旦摄像机运镜位置分量
 * 意外流入本函数（说明分组拦截条件与此处判断条件不一致，编译器内部不变量被破坏），直接
 * 抛错，避免静默退化为错误的两点直插。fov/color 等非位置属性、以及 direct/未设置运镜的
 * 摄像机位置分量，继续走本函数的两点直插逻辑。
 */
function compileTransitionPoints(
  object: StageObject,
  move: StageCameraMove | undefined,
  fromValue: StageKeyframeValue,
  toValue: StageKeyframeValue,
  segStart: number,
  segEnd: number,
  easing: StageEasingPreset,
  propertyPath: string,
): StageKeyframe[] {
  if (object.type === 'camera' && move !== undefined && move.kind !== 'direct' && isCameraPositionAxisPath(propertyPath)) {
    throw new Error(
      `[cameraStage] 摄像机运镜预设的位置分量（${propertyPath}）应在 compileObjectTransition 的 ` +
        'transform.position 分组处被拦截（见 compileCameraPositionGroup），不应走两点直插逻辑；' +
        '命中此错误说明拦截条件与本函数的判断条件不一致，请检查 isCameraPositionMoveGroup / isCameraPositionAxisPath',
    )
  }
  return [
    { time: segStart, value: fromValue, easing },
    { time: segEnd, value: toValue, easing: 'linear' },
  ]
}

function isCameraPositionMoveGroup(
  object: StageObject,
  group: AnimatableGroup,
  move: StageCameraMove | undefined,
): boolean {
  return object.type === 'camera' && group.groupPath === 'transform.position' && move !== undefined && move.kind !== 'direct'
}

/** 编译摄像机运镜预设在本段过渡的位置轨道：三分量一次性算出采样点，写入 x/y/z 三条 scalar 轨道 */
function compileCameraPositionGroup(
  trackMap: TrackMap,
  cameraId: string,
  fromPosition: StageVec3,
  move: Exclude<StageCameraMove, { kind: 'direct' }>,
  targetPosition: StageVec3,
  segStart: number,
  segEnd: number,
  easing: StageEasingPreset,
  holdGuard: HoldGuard,
): void {
  const samples = compileCameraMoveSamples(move, fromPosition, targetPosition, segStart, segEnd, easing)
  const endPosition = samples[samples.length - 1].position
  const axes: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z']
  for (const axis of axes) {
    const propertyPath = `transform.position.${axis}`
    for (const sample of samples) {
      writeKeyframe(trackMap, cameraId, propertyPath, { time: sample.time, value: sample.position[axis], easing: sample.easing })
    }
    if (holdGuard.enabled) {
      writeKeyframe(trackMap, cameraId, propertyPath, { time: holdGuard.time, value: endPosition[axis], easing: 'linear' })
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
  cameraLookAtTarget?: StageVec3,
  motionSchedule?: StageCharacterMotionScheduleEntry[],
  motionOverride?: import('./characterMotion').StageCharacterMotion,
): void {
  const fromObject = mergeStateIntoObject(object, fromState)
  const toObject = mergeStateIntoObject(object, toState)
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
    if (isCameraPositionMoveGroup(object, group, move)) {
      compileCameraPositionGroup(
        trackMap,
        object.id,
        fromState.transform.position,
        move as Exclude<StageCameraMove, { kind: 'direct' }>,
        cameraLookAtTarget ?? fromState.transform.position,
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

      const points = compileTransitionPoints(object, move, fromValue, toValue, segStart, segEnd, easing, descriptor.path)
      for (const point of points) {
        writeKeyframe(trackMap, object.id, descriptor.path, point)
      }
      if (holdGuard.enabled) {
        writeKeyframe(trackMap, object.id, descriptor.path, { time: holdGuard.time, value: toValue, easing: 'linear' })
      }
    }
  }
}

/**
 * 解析摄像机运镜预设的取景目标点：取过渡起始卡（fromShot）快照中的 lookAt 解析结果。
 * 一期简化（对齐任务文件"当前情况"约定）：object 模式取目标对象在 fromShot 快照中的位置，
 * 不追踪目标自身在本段过渡中的移动；朝向偏移逻辑对齐 cameraUtils.ts 的 getObjectLookAtPoint
 * （角色目标取胸口高度，即 position.y + 1 * scale.y），只是取值源从"当前场景对象"换成"镜头卡快照"。
 */
function resolveShotLookAtTarget(cameraState: StageShotObjectState, fromShot: StageShot, objects: StageObject[]): StageVec3 {
  const lookAt = cameraState.lookAt
  if (!lookAt) return { x: 0, y: 0, z: 0 }
  if (lookAt.mode === 'manual') return { ...lookAt.target }

  const liveTarget = objects.find((item) => item.id === lookAt.objectId)
  const targetState = fromShot.objectStates[lookAt.objectId]
  if (!liveTarget || !targetState) return { ...lookAt.fallbackTarget }

  const { position } = targetState.transform
  if (liveTarget.type === 'character') {
    return { x: position.x, y: position.y + 1 * targetState.transform.scale.y, z: position.z }
  }
  return { ...position }
}

function finalizeTracks(trackMap: TrackMap, shots: StageShot[]): StageTrack[] {
  const tracks: StageTrack[] = []
  for (const [key, keyframes] of trackMap) {
    const separatorIndex = key.indexOf(TRACK_KEY_SEPARATOR)
    tracks.push({
      objectId: key.slice(0, separatorIndex),
      propertyPath: key.slice(separatorIndex + TRACK_KEY_SEPARATOR.length),
      keyframes: keyframes.map((keyframe) => {
        const shot = shots.find((item) => Math.abs(item.time - keyframe.time) <= 1e-4)
        return shot ? { ...keyframe, continuity: shot.continuity } : keyframe
      }),
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
    return { tracks: [], motionSchedule: [], duration: 0, fps: CAMERA_STAGE_DEFAULT_FPS }
  }

  const timeline = buildShotTimeline(shots)
  const duration = timeline[timeline.length - 1].transitionEnd
  const trackMap: TrackMap = new Map()
  const motionSchedule: StageCharacterMotionScheduleEntry[] = []

  for (let i = 0; i < shots.length - 1; i += 1) {
    const fromShot = shots[i]
    const toShot = shots[i + 1]
    const seg = timeline[i]
    const holdGuard: HoldGuard = { enabled: false, time: seg.transitionEnd }

    for (const object of objects) {
      const fromState = fromShot.objectStates[object.id]
      const toState = toShot.objectStates[object.id]
      if (!fromState || !toState) continue

      const detail = fromShot.transition.perObject[object.id]
      const easing = hasForcedHardCut(fromShot, toShot)
        ? 'hold'
        : resolveSpeedPresetEasing(detail?.speedPreset)
      const [segStart, segEnd] = applyTransitionDelay(seg.transitionStart, seg.transitionEnd, detail?.delay ?? 0)
      const move = object.type === 'camera' && !hasForcedHardCut(fromShot, toShot)
        ? fromShot.transition.cameraMoves[object.id]
        : undefined
      const cameraLookAtTarget =
        object.type === 'camera' && move !== undefined && move.kind !== 'direct'
          ? resolveShotLookAtTarget(fromState, fromShot, objects)
          : undefined

      compileObjectTransition(
        trackMap,
        object,
        fromState,
        toState,
        move,
        segStart,
        segEnd,
        easing,
        holdGuard,
        cameraLookAtTarget,
        motionSchedule,
        detail?.motionOverride,
      )
    }
  }

  return { tracks: finalizeTracks(trackMap, shots), motionSchedule, duration, fps: CAMERA_STAGE_DEFAULT_FPS }
}
