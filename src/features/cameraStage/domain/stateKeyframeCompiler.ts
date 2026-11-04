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
 * - 摄像机运镜预设在写入状态关键帧时物化为 StageSpatialPath；本编译器只登记路径段并串成
 *   平滑衔接链（spatialMotions），整条链由 spatialMotionEngine 作为一次连续运动求值。
 * - 摄像机两端注视同一目标的区间登记为 aim（cameraOrientations），朝向逐帧求解。
 * - 角色走跑：位置一律走路径链（与摄像机同一套时间律），动作、步伐同步与朝向由 characterMotionTimeline 编出。
 * - 摄像机跟拍：过渡细节 follow 编成 cameraFollows，采样内核在区间内按主体求机位与注视点。
 */

import { listAnimatableGroups } from './animatableProps'
import { getObjectLookAtPoint } from './cameraUtils'
import {
  CAMERA_STAGE_DEFAULT_FPS,
  KEYFRAME_TIME_EPSILON,
  type StageAnimatableValueType,
  type StageCameraOrientationEntry,
  type StageEasingPreset,
  type StageSpatialMotion,
  type StageSpatialMotionSegment,
  type StageKeyframe,
  type StageKeyframeValue,
  type StageCameraFollowEntry,
  type StageCharacterHeadingEntry,
  type StageCharacterMotionTimeline,
  type StageSceneAnimation,
  type StageTrack,
} from './animationTypes'
import { upsertKeyframe } from './keyframeEngine'
import type { StageCharacterMotion } from './characterMotion'
import type { StageCameraLookAt, StageObject, StageVec3 } from './sceneTypes'
import { rotationFromPositionAndTarget } from './cameraUtils'
import { buildCharacterMotionTimeline, type CharacterTransitionInterval } from './characterMotionTimeline'
import { defaultSpatialPath } from './spatialPath'
import type { StageStateKeyframe, StageStateKeyframeObjectState, StageSpatialPath, StageSpeedPreset } from './stateKeyframeTypes'

/** scalar 属性差异容差：|a-b| 不超过该值视为未变化 */
const SCALAR_EPSILON = 1e-3

const SPEED_PRESET_EASING: Record<StageSpeedPreset, StageEasingPreset> = {
  uniform: 'linear',
  easeInOut: 'easeInOut',
  fastStart: 'easeOut',
  slowStart: 'easeIn',
  cruise: 'cruise',
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
 * 因为此时无法确定该段实际是否跨机位——保持与改动前一致的行为，避免旧镜头参考/单机位镜头参考误判。
 * 导出供 UI 层（3.2 过渡块/气泡的跨机位硬切呈现）复用，不另起一套判断。
 */
export function hasForcedHardCut(current: StageStateKeyframe, next: StageStateKeyframe): boolean {
  return !!current.cameraId && !!next.cameraId && current.cameraId !== next.cameraId
}

/** 绝对时间点决定过渡区间；跨机位硬切在区间末端发生。 */
export function buildStateKeyframeTimeline(stateKeyframes: StageStateKeyframe[]): StateKeyframeTimelineSegment[] {
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

/** 一段空间路径过渡及其所在的状态关键帧区间序号，用于串成平滑衔接链。 */
interface IndexedSpatialSegment {
  intervalIndex: number
  segment: StageSpatialMotionSegment
}

/**
 * 空间路径段只在轨道上写起止端点：段内位置由采样内核按弧长在运行时取点。
 * 端点保证停留段、错峰延迟之外的时间仍取到正确机位；continuity 固定为 stop，
 * 免得相邻直插段的通用 Hermite 把路径端点当成平滑点去推切线。
 */
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
): StageSpatialMotionSegment {
  for (const axis of ['x', 'y', 'z'] as const) {
    const propertyPath = `transform.position.${axis}`
    writeKeyframe(trackMap, objectId, propertyPath, { time: segStart, value: fromPosition[axis], easing, continuity: 'stop' })
    writeKeyframe(trackMap, objectId, propertyPath, { time: segEnd, value: toPosition[axis], easing: 'linear', continuity: 'stop' })
    if (holdGuard.enabled) {
      writeKeyframe(trackMap, objectId, propertyPath, { time: holdGuard.time, value: toPosition[axis], easing: 'linear' })
    }
  }
  return { startTime: segStart, endTime: segEnd, from: { ...fromPosition }, to: { ...toPosition }, path, easing }
}

/**
 * 把同一对象的空间路径段串成链：相邻区间首尾相接（没有错峰停顿）、衔接卡为“平滑通过”、
 * 两侧都不是硬切时并入同一条链，链内衔接点位置、速度、加速度连续；其余各自成链，两端按速度预设停靠。
 */
function chainSpatialSegments(
  segmentsByObject: Map<string, IndexedSpatialSegment[]>,
  stateKeyframes: StageStateKeyframe[],
  objects: StageObject[],
): StageSpatialMotion[] {
  const motions: StageSpatialMotion[] = []
  for (const [objectId, indexed] of segmentsByObject) {
    const object = objects.find((item) => item.id === objectId)
    const rig = object?.type === 'camera' ? object.rig : undefined
    let current: StageSpatialMotion | null = null
    let previous: IndexedSpatialSegment | null = null
    for (const item of indexed) {
      const joins = previous !== null
        && item.intervalIndex === previous.intervalIndex + 1
        && stateKeyframes[item.intervalIndex].continuity === 'smooth'
        && Math.abs(item.segment.startTime - previous.segment.endTime) <= KEYFRAME_TIME_EPSILON
        && item.segment.easing !== 'hold'
        && previous.segment.easing !== 'hold'
      if (joins && current) {
        current.segments.push(item.segment)
      } else {
        current = rig ? { objectId, segments: [item.segment], rig } : { objectId, segments: [item.segment] }
        motions.push(current)
      }
      previous = item
    }
  }
  return motions
}

function positionChanged(a: StageVec3, b: StageVec3): boolean {
  return Math.abs(a.x - b.x) > SCALAR_EPSILON || Math.abs(a.y - b.y) > SCALAR_EPSILON || Math.abs(a.z - b.z) > SCALAR_EPSILON
}

/**
 * 每个对象各区间实际走的空间路径（区间序号 → 路径）。
 *
 * 显式路径照用。没有路径的直线位移在两种情况下也按直线路径并入链：与路径段平滑相连（直线接环绕），
 * 或者对象是挂了运镜设备的摄像机。否则直插轨道在路径端点被迫停靠，衔接处速度降到零；
 * 设备的时间律也只作用在链上。角色走跑一律走路径链（走位的路线与时间律都在链上），其余对象的直线位移仍走轨道。
 */
function resolveSpatialPaths(stateKeyframes: StageStateKeyframe[], objects: StageObject[]): Map<string, Map<number, StageSpatialPath>> {
  const timeline = buildStateKeyframeTimeline(stateKeyframes)
  const result = new Map<string, Map<number, StageSpatialPath>>()
  for (const object of objects) {
    // 角色走跑与挂了设备的摄像机一样走路径链：时间律（含 cruise）与转弯融合都在链上，路程也按链取样。
    const rigged = (object.type === 'camera' && (object.rig ?? 'free') !== 'free') || object.type === 'character'
    const intervals = stateKeyframes.slice(0, -1).map((fromStateKeyframe, index) => {
      const toStateKeyframe = stateKeyframes[index + 1]
      const from = fromStateKeyframe.objectStates[object.id]?.transform.position
      const to = toStateKeyframe.objectStates[object.id]?.transform.position
      const detail = fromStateKeyframe.transition.perObject[object.id]
      const hardCut = hasForcedHardCut(fromStateKeyframe, toStateKeyframe)
      const [start, end] = applyTransitionDelay(timeline[index].transitionStart, timeline[index].transitionEnd, detail?.delay ?? 0)
      const explicit = from && to ? detail?.spatialPath : undefined
      const moved = !!from && !!to && !hardCut && (!!explicit || positionChanged(from, to))
      return { from, to, explicit, moved, start, end }
    })
    const paths = new Map<number, StageSpatialPath>()
    let runStart = 0
    for (let index = 1; index <= intervals.length; index += 1) {
      const previous = intervals[index - 1]
      const current = intervals[index]
      const continues = !!current && previous.moved && current.moved
        && stateKeyframes[index].continuity === 'smooth'
        && Math.abs(current.start - previous.end) <= KEYFRAME_TIME_EPSILON
      if (continues) continue
      const run = intervals.slice(runStart, index)
      if (rigged || run.some((item) => item.explicit && item.moved)) {
        run.forEach((item, offset) => {
          if (item.moved && item.from && item.to) paths.set(runStart + offset, item.explicit ?? defaultSpatialPath(item.from, item.to))
        })
      }
      runStart = index
    }
    // 硬切区间不并链，但显式路径仍要登记，端点关键帧由路径分组负责。
    intervals.forEach((item, index) => {
      if (!paths.has(index) && item.explicit) paths.set(index, item.explicit)
    })
    if (paths.size > 0) result.set(object.id, paths)
  }
  return result
}

/** 两端注视点是否为同一目标：同一对象，或同一手动注视点。 */
function isSameLookAtTarget(a: StageCameraLookAt, b: StageCameraLookAt): boolean {
  if (a.mode === 'object' || b.mode === 'object') {
    return a.mode === 'object' && b.mode === 'object' && a.objectId === b.objectId
  }
  return Math.hypot(a.target.x - b.target.x, a.target.y - b.target.y, a.target.z - b.target.z) <= 1e-6
}

type TrackMap = Map<string, StageKeyframe[]>

const TRACK_KEY_SEPARATOR = '::'

function trackKey(objectId: string, propertyPath: string): string {
  return `${objectId}${TRACK_KEY_SEPARATOR}${propertyPath}`
}

/** 写入一个关键帧点，同轨道同时间（±KEYFRAME_TIME_EPSILON）只保留后写入的点（复用 upsertKeyframe） */
function writeKeyframe(trackMap: TrackMap, objectId: string, propertyPath: string, keyframe: StageKeyframe): void {
  const key = trackKey(objectId, propertyPath)
  const merged = upsertKeyframe(trackMap.get(key) ?? [], keyframe)
  // 显式给出的 continuity 必须生效：空间路径端点与相邻直插段同点时，要强制停靠，
  // 否则直插段的 Hermite 会拿路径另一端当邻点去推切线。
  if (keyframe.continuity !== undefined) {
    const index = merged.findIndex((item) => Math.abs(item.time - keyframe.time) <= KEYFRAME_TIME_EPSILON)
    if (index >= 0) merged[index] = { ...merged[index], continuity: keyframe.continuity }
  }
  trackMap.set(key, merged)
}

interface HoldGuard {
  enabled: boolean
  time: number
}

/**
 * 编译单个对象在一段过渡内变化的属性，写入 trackMap。角色的过渡另登记进 characterIntervals，
 * 全部轨道与路径链编好后再据此编动作时间线与朝向表。
 */
function compileObjectTransition(
  output: CompileOutput,
  interval: { index: number; start: number; end: number },
  object: StageObject,
  fromState: StageStateKeyframeObjectState,
  toState: StageStateKeyframeObjectState,
  segStart: number,
  segEnd: number,
  easing: StageEasingPreset,
  holdGuard: HoldGuard,
  motionOverride?: StageCharacterMotion,
  spatialPath?: StageSpatialPath,
  /** 场景全部对象，用于把 object 模式的注视点解析成目标物体的实时位置。 */
  sceneObjects: StageObject[] = [],
): void {
  const { trackMap } = output
  const fromObject = mergeStateIntoObject(object, fromState, sceneObjects)
  const toObject = mergeStateIntoObject(object, toState, sceneObjects)
  // 走动的角色朝向由朝向表在区间内求出；轨道只写两端，播放时才会推送朝向分组。
  const walking = object.type === 'character' && easing !== 'hold' && positionChanged(fromState.transform.position, toState.transform.position)
  if (object.type === 'character') {
    output.characterIntervals.push({
      objectId: object.id,
      interval: { intervalIndex: interval.index, segStart, segEnd, hardCut: easing === 'hold', fromState, toState, ...(motionOverride ? { motionOverride } : {}) },
    })
  }

  /*
   * 两端注视同一目标时，朝向是“位置 + 注视点”的函数，不是两个欧拉角之间的插值：
   * 环绕超过 180° 时按最短路径换算的欧拉角会让镜头中段背对主体，而且播放（插值轨道）
   * 与导出（实时注视）会算出两种画面。这类区间登记为 aim，由采样内核逐帧求朝向。
   * 注视点不同（作者手动转过镜头）才保留欧拉角插值；roll 不在注视点里，始终走轨道。
   */
  const aimsAtSameTarget = object.type === 'camera'
    && isSameLookAtTarget(fromState.lookAt ?? object.lookAt, toState.lookAt ?? object.lookAt)
  if (object.type === 'camera') {
    output.cameraOrientations.push(aimsAtSameTarget
      ? { objectId: object.id, startTime: interval.start, endTime: interval.end, mode: 'aim', lookAt: structuredClone(fromState.lookAt ?? object.lookAt) }
      : { objectId: object.id, startTime: interval.start, endTime: interval.end, mode: 'authored' })
  }

  if (walking) {
    const fromYaw = fromState.transform.rotation.y
    writeKeyframe(trackMap, object.id, 'transform.rotation.y', { time: segStart, value: fromYaw, easing: 'linear' })
    writeKeyframe(trackMap, object.id, 'transform.rotation.y', { time: segEnd, value: unwrapNearestAngle(fromYaw, toState.transform.rotation.y), easing: 'linear' })
  }

  for (const group of listAnimatableGroups(object)) {
    if (group.groupPath === 'transform.position' && spatialPath) {
      const segment = compileSpatialPositionGroup(
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
      const indexed = output.spatialSegments.get(object.id) ?? []
      indexed.push({ intervalIndex: interval.index, segment })
      output.spatialSegments.set(object.id, indexed)
      continue
    }
    for (const descriptor of group.children) {
      if (walking && descriptor.path === 'transform.rotation.y') continue
      const isCameraAngle = object.type === 'camera' && descriptor.path.startsWith('transform.rotation.')
      const isAimedAngle = isCameraAngle && descriptor.path !== 'transform.rotation.z'
      // 整条序列都在注视同一目标时，俯仰/水平角完全由内核求解，不需要轨道。
      if (isAimedAngle && !output.authoredRotationCameraIds.has(object.id)) continue
      const rawFromValue = descriptor.getValue(fromObject)
      // 连续几段手动转镜头时，起点角度接在上一段终点的同一圈上，避免跨 ±180° 后绕远路。
      const previousAngle = isCameraAngle ? trackMap.get(trackKey(object.id, descriptor.path))?.at(-1)?.value : undefined
      const fromValue = typeof previousAngle === 'number' && typeof rawFromValue === 'number'
        ? unwrapNearestAngle(previousAngle, rawFromValue)
        : rawFromValue
      const rawToValue = descriptor.getValue(toObject)
      const toValue = isCameraAngle
        && typeof fromValue === 'number'
        && typeof rawToValue === 'number'
        ? unwrapNearestAngle(fromValue, rawToValue)
        : rawToValue
      /*
       * 摄像机只要有一段手动转镜头，俯仰/水平角就逐段写满两端关键帧：手动区间完全靠轨道取朝向，
       * 若注视区间或角度未变的区间留空，手动区间会从更早的关键帧开始插值或夹取，出现跳变。
       * 注视区间里的这些值只用来保持轨道连续，采样时由内核按注视点覆盖。
       */
      if (!isAimedAngle && !hasPropertyChanged(descriptor.valueType, fromValue, toValue)) continue

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

interface CompileOutput {
  /** 至少有一段两端注视点不同（作者手动转过镜头）的摄像机。 */
  authoredRotationCameraIds: ReadonlySet<string>
  trackMap: TrackMap
  characterIntervals: Array<{ objectId: string; interval: CharacterTransitionInterval }>
  spatialSegments: Map<string, IndexedSpatialSegment[]>
  cameraOrientations: StageCameraOrientationEntry[]
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

function collectAuthoredRotationCameraIds(stateKeyframes: StageStateKeyframe[], objects: StageObject[]): Set<string> {
  const ids = new Set<string>()
  for (const object of objects) {
    if (object.type !== 'camera') continue
    for (let i = 0; i < stateKeyframes.length - 1; i += 1) {
      const fromState = stateKeyframes[i].objectStates[object.id]
      const toState = stateKeyframes[i + 1].objectStates[object.id]
      if (fromState && toState && !isSameLookAtTarget(fromState.lookAt ?? object.lookAt, toState.lookAt ?? object.lookAt)) {
        ids.add(object.id)
        break
      }
    }
  }
  return ids
}

/**
 * 把状态关键帧序列编译成场景动画（纯函数，无副作用）。
 *
 * @param stateKeyframes 状态关键帧序列（按时间顺序）；空数组返回空轨道、duration=0
 * @param objects 当前场景对象列表：用于取可动画属性分组与结构字段，属性取值以状态关键帧快照为准
 */
export function compileStateKeyframesToAnimation(stateKeyframes: StageStateKeyframe[], objects: StageObject[]): StageSceneAnimation {
  if (stateKeyframes.length === 0) {
    return { tracks: [], characterMotions: [], characterHeadings: [], spatialMotions: [], cameraOrientations: [], cameraFollows: [], duration: 0, fps: CAMERA_STAGE_DEFAULT_FPS }
  }

  const timeline = buildStateKeyframeTimeline(stateKeyframes)
  const duration = timeline[timeline.length - 1].transitionEnd
  const spatialPaths = resolveSpatialPaths(stateKeyframes, objects)
  const output: CompileOutput = {
    authoredRotationCameraIds: collectAuthoredRotationCameraIds(stateKeyframes, objects),
    trackMap: new Map(),
    characterIntervals: [],
    spatialSegments: new Map(),
    cameraOrientations: [],
  }

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
        output,
        { index: i, start: seg.transitionStart, end: seg.transitionEnd },
        object,
        fromState,
        toState,
        segStart,
        segEnd,
        easing,
        holdGuard,
        detail?.motionOverride,
        spatialPaths.get(object.id)?.get(i),
        objects,
      )
    }
  }

  const tracks = finalizeTracks(output.trackMap, stateKeyframes)
  const spatialMotions = chainSpatialSegments(output.spatialSegments, stateKeyframes, objects)
  const characters = compileCharacterMotions(stateKeyframes, objects, output.characterIntervals, tracks, spatialMotions)
  return {
    tracks,
    characterMotions: characters.timelines,
    characterHeadings: characters.headings,
    spatialMotions,
    cameraOrientations: output.cameraOrientations,
    cameraFollows: compileCameraFollows(stateKeyframes, objects),
    duration,
    fps: CAMERA_STAGE_DEFAULT_FPS,
  }
}

/** 每个角色的动作时间线与走跑朝向表；没有状态关键帧快照的角色不编。 */
function compileCharacterMotions(
  stateKeyframes: StageStateKeyframe[],
  objects: StageObject[],
  intervals: CompileOutput['characterIntervals'],
  tracks: StageTrack[],
  spatialMotions: StageSpatialMotion[],
): { timelines: StageCharacterMotionTimeline[]; headings: StageCharacterHeadingEntry[] } {
  const timelines: StageCharacterMotionTimeline[] = []
  const headings: StageCharacterHeadingEntry[] = []
  // 人群布景里有成千上万个角色：过渡按角色先分好组，免得逐个角色扫一遍全部过渡。
  const byObject = new Map<string, CharacterTransitionInterval[]>()
  for (const item of intervals) {
    const list = byObject.get(item.objectId) ?? []
    list.push(item.interval)
    byObject.set(item.objectId, list)
  }
  for (const object of objects) {
    if (object.type !== 'character' || !stateKeyframes.some((stateKeyframe) => stateKeyframe.objectStates[object.id])) continue
    const built = buildCharacterMotionTimeline({
      character: object,
      keyframeTimes: stateKeyframes.map((stateKeyframe) => stateKeyframe.time),
      keyframeMotions: stateKeyframes.map((stateKeyframe) => stateKeyframe.objectStates[object.id]?.motion),
      intervals: byObject.get(object.id) ?? [],
      tracks,
      spatialMotions,
    })
    timelines.push(built.timeline)
    headings.push(...built.headings)
  }
  return { timelines, headings }
}

/** 摄像机过渡细节里的跟拍：相邻区间设置相同就合并成一段，滤波在整段上连续。 */
function compileCameraFollows(stateKeyframes: StageStateKeyframe[], objects: StageObject[]): StageCameraFollowEntry[] {
  const timeline = buildStateKeyframeTimeline(stateKeyframes)
  const entries: StageCameraFollowEntry[] = []
  for (const object of objects) {
    if (object.type !== 'camera') continue
    let current: StageCameraFollowEntry | null = null
    for (let index = 0; index < stateKeyframes.length - 1; index += 1) {
      const stateKeyframe = stateKeyframes[index]
      const follow = stateKeyframe.transition.perObject[object.id]?.follow
      const { transitionStart, transitionEnd } = timeline[index]
      if (!follow || !objects.some((item) => item.id === follow.subjectId)
        || hasForcedHardCut(stateKeyframe, stateKeyframes[index + 1]) || !(transitionEnd > transitionStart)) {
        current = null
        continue
      }
      if (current && Math.abs(current.endTime - transitionStart) <= KEYFRAME_TIME_EPSILON && JSON.stringify(current.follow) === JSON.stringify(follow)) {
        current.endTime = transitionEnd
        continue
      }
      current = { cameraId: object.id, startTime: transitionStart, endTime: transitionEnd, follow: structuredClone(follow) }
      entries.push(current)
    }
  }
  return entries
}
