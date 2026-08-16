/**
 * 状态关键帧核心数据类型（纯数据，禁止 UI/three 依赖）。
 *
 * 状态关键帧（StageStateKeyframe）= 全场景可动画对象状态快照 + 到下一关键帧的过渡信息；
 * 过渡细节（速度预设/错峰延迟/摄像机运镜预设）挂在 transition 字段上，
 * 由 1.2 快照差异编译器读取生成关键帧，播放/导出链路零改动。
 *
 * 摄像机效果器（StageCameraEffector）一期仅摄像机可挂，本任务只定义类型与默认空数组，
 * 采样叠加逻辑在 3.1 实装。
 */

import { v4 as uuidv4 } from 'uuid'
import type { AnimatableGroup } from './animatableProps'
import { getAnimatableGroupByPath } from './animatableProps'
import { normalizeCharacterMotion } from './characterMotion'
import type { StageCharacterMotion } from './characterMotion'
import { clonePose } from './poseTypes'
import type { StageCharacterPose } from './poseTypes'
import type { StageCameraLookAt, StageObject, StageTransform, StageVec3 } from './sceneTypes'

/** 单对象在某张状态关键帧中的可动画状态快照 */
export interface StageStateKeyframeObjectState {
  transform: StageTransform
  color: string
  /** 仅摄像机 */
  fov?: number
  /** 仅摄像机（运镜预设需要目标） */
  lookAt?: StageCameraLookAt
  /** 仅角色 */
  pose?: StageCharacterPose
  /** 仅角色（卡内动作，如"待机"） */
  motion?: StageCharacterMotion
}

export type StageSpeedPreset = 'uniform' | 'easeInOut' | 'fastStart' | 'slowStart'

/**
 * 摄像机运镜预设判别联合（参数于 1.3 定稿）。
 * - direct：两点直插（默认值，无参数）。
 * - orbit：绕世界 Y 轴、以 lookAt 目标为圆心环绕，起始机位半径/高度不变，扫过 degrees。
 *   终点语义（重要记录 003 已定稿）：终点由环绕几何决定，覆盖/忽略 B 卡摆放的机位。
 * - dollyIn/dollyOut：沿"机位→目标"连线按 distanceRatio 缩放距离（0.5=推到一半距离，>1=拉远）。
 * - truck：在水平面内垂直于视线方向平移 offset（横移）。
 * - crane：沿世界 Y 轴平移 height（升降）。
 */
export type StageCameraMove =
  | { kind: 'direct' }
  | { kind: 'orbit'; degrees: number; direction: 'cw' | 'ccw' }
  | { kind: 'dollyIn' | 'dollyOut'; distanceRatio: number }
  | { kind: 'truck'; offset: number }
  | { kind: 'crane'; height: number }

export type StageCameraMovePreset = Exclude<StageCameraMove, { kind: 'direct' }>

export type StageSpatialPathSource =
  | { kind: 'preset'; preset: StageCameraMovePreset }
  | { kind: 'custom'; originPreset?: StageCameraMovePreset }

/** 过渡内部的空间关键点；position 为世界坐标，切线为相对该点的偏移。 */
export interface StageSpatialPathKnot {
  id: string
  position: StageVec3
  inTangent: StageVec3
  outTangent: StageVec3
}

/**
 * 分段三次贝塞尔空间路径。起终点由相邻状态关键帧快照提供，避免重复存储后发生漂移；
 * knots 仅保存过渡内部的空间关键点。
 */
export interface StageSpatialPath {
  kind: 'bezier'
  source: StageSpatialPathSource
  startOutTangent: StageVec3
  knots: StageSpatialPathKnot[]
  endInTangent: StageVec3
}

/** 单个对象在过渡段的细节覆盖：速度预设 / 错峰延迟 / 动作覆盖 */
export interface StageStateKeyframeTransitionObjectDetail {
  speedPreset?: StageSpeedPreset
  /** 未设置 = 直线；设置后位置按三次贝塞尔空间路径编译。 */
  spatialPath?: StageSpatialPath
  /** 错峰延迟（秒，可为负=提前，编译时钳制到过渡区间内） */
  delay?: number
  /** 覆盖自动走跑推断得到的卡内动作 */
  motionOverride?: StageCharacterMotion
}

export interface StageStateKeyframeTransition {
  perObject: Record<string, StageStateKeyframeTransitionObjectDetail>
}

export interface StageStateKeyframe {
  id: string
  /** 默认“关键帧 N” */
  name: string
  /** 状态关键帧在时间轴上的绝对时间（秒，写入时按 fps 量化）。 */
  time: number
  /** 到达本关键帧时是否保持速度连续；stop = 在本点停靠，smooth = 无缝通过。 */
  continuity: 'stop' | 'smooth'
  /** 停留时长（秒，≥0） */
  hold: number
  /** 到下一状态关键帧的过渡时长（秒，末点忽略） */
  transitionDuration: number
  objectStates: Record<string, StageStateKeyframeObjectState>
  transition: StageStateKeyframeTransition
  /**
   * 拍摄机位（可选，重要记录 005）：null/缺失 = 未指定，渲染/导出时沿用全局 activeCameraId。
   * 创建时取当前 activeCameraId；相邻两点机位均已指定且不同时，两点之间的过渡在布点层
   * （buildStateKeyframeTimeline）强制视为 0 时长硬切，本字段与 transitionDuration 本身不互相改写。
   */
  cameraId: string | null
}

/** 摄像机效果器（3.1 实装，本任务仅类型 + 默认空数组） */
export interface StageCameraEffector {
  id: string
  kind: 'handheld' | 'breathing'
  enabled: boolean
  intensity: number
  frequency: number
}

/** 新建状态关键帧默认零停留时长；hold 仅保留用于兼容旧工程数据。 */
export const STAGE_STATE_KEYFRAME_DEFAULT_HOLD = 0
export const STAGE_STATE_KEYFRAME_DEFAULT_TRANSITION_DURATION = 2
const STAGE_STATE_KEYFRAME_DEFAULT_NAME = '关键帧'

function requireAnimatableGroup(path: string): AnimatableGroup {
  const group = getAnimatableGroupByPath(path)
  if (!group) {
    throw new Error(`[cameraStage] 缺少可动画属性分组：${path}`)
  }
  return group
}

const TRANSFORM_POSITION_GROUP = requireAnimatableGroup('transform.position')
const TRANSFORM_ROTATION_GROUP = requireAnimatableGroup('transform.rotation')
const TRANSFORM_SCALE_GROUP = requireAnimatableGroup('transform.scale')
const COLOR_GROUP = requireAnimatableGroup('color')
const FOV_GROUP = requireAnimatableGroup('fov')

/** 捕获单个对象当前可动画状态，供创建/自动记录使用；复用 animatableProps 的取值逻辑，不手写逐字段拷贝 */
export function captureStateKeyframeObjectState(object: StageObject): StageStateKeyframeObjectState {
  const position = TRANSFORM_POSITION_GROUP.getBaseValue(object) as StageVec3
  const rotation = TRANSFORM_ROTATION_GROUP.getBaseValue(object) as StageVec3
  const scale = TRANSFORM_SCALE_GROUP.getBaseValue(object) as StageVec3
  const state: StageStateKeyframeObjectState = {
    transform: {
      position: { ...position },
      rotation: { ...rotation },
      scale: { ...scale },
    },
    color: COLOR_GROUP.getBaseValue(object) as string,
  }

  if (object.type === 'camera') {
    state.fov = FOV_GROUP.getBaseValue(object) as number
    state.lookAt = structuredClone(object.lookAt)
  }
  if (object.type === 'character') {
    state.pose = clonePose(object.pose)
    state.motion = object.motion
  }

  return state
}

/**
 * 由当前场景对象列表新建一枚状态关键帧：捕获全部对象状态，过渡细节留空由编译器按默认规则处理。
 * `cameraId` 创建时取调用方当前的 activeCameraId；省略/传 null 表示未指定机位（沿用全局值）。
 */
export function createStateKeyframe(
  objects: StageObject[],
  name: string,
  cameraId: string | null = null,
  time = 0,
): StageStateKeyframe {
  const objectStates: Record<string, StageStateKeyframeObjectState> = {}
  for (const object of objects) {
    objectStates[object.id] = captureStateKeyframeObjectState(object)
  }
  return {
    id: uuidv4(),
    name,
    time: Math.max(0, time),
    continuity: 'stop',
    hold: STAGE_STATE_KEYFRAME_DEFAULT_HOLD,
    transitionDuration: STAGE_STATE_KEYFRAME_DEFAULT_TRANSITION_DURATION,
    objectStates,
    transition: { perObject: {} },
    cameraId,
  }
}

function normalizeStateKeyframeTransitionObjectDetail(raw: unknown): StageStateKeyframeTransitionObjectDetail {
  if (!raw || typeof raw !== 'object') return {}
  const record = raw as Record<string, unknown>
  const speedPreset = record.speedPreset
  const delay = Number(record.delay)
  const detail: StageStateKeyframeTransitionObjectDetail = {}
  if (
    speedPreset === 'uniform' ||
    speedPreset === 'easeInOut' ||
    speedPreset === 'fastStart' ||
    speedPreset === 'slowStart'
  ) {
    detail.speedPreset = speedPreset
  }
  if (Number.isFinite(delay)) {
    detail.delay = delay
  }
  if (record.motionOverride !== undefined) {
    detail.motionOverride = normalizeCharacterMotion(record.motionOverride)
  }
  const spatialPath = record.spatialPath
  if (spatialPath && typeof spatialPath === 'object') {
    const path = spatialPath as Record<string, unknown>
    const normalizeTangent = (value: unknown): StageVec3 | null => {
      if (!value || typeof value !== 'object') return null
      const vec = value as Record<string, unknown>
      const x = Number(vec.x)
      const y = Number(vec.y)
      const z = Number(vec.z)
      return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? { x, y, z } : null
    }
    const normalizePreset = (value: unknown): StageCameraMovePreset | undefined => {
      const move = normalizeCameraMove(value)
      return move && move.kind !== 'direct' ? move : undefined
    }
    const normalizeSource = (value: unknown): StageSpatialPathSource => {
      if (!value || typeof value !== 'object') return { kind: 'custom' }
      const source = value as Record<string, unknown>
      const preset = normalizePreset(source.preset)
      if (source.kind === 'preset' && preset) return { kind: 'preset', preset }
      const originPreset = normalizePreset(source.originPreset)
      return originPreset ? { kind: 'custom', originPreset } : { kind: 'custom' }
    }
    const startOutTangent = normalizeTangent(path.startOutTangent)
    const endInTangent = normalizeTangent(path.endInTangent)
    if (path.kind === 'bezier' && startOutTangent && endInTangent) {
      const knots = Array.isArray(path.knots) ? path.knots.flatMap((rawKnot) => {
        if (!rawKnot || typeof rawKnot !== 'object') return []
        const knot = rawKnot as Record<string, unknown>
        const position = normalizeTangent(knot.position)
        const inTangent = normalizeTangent(knot.inTangent)
        const outTangent = normalizeTangent(knot.outTangent)
        if (!position || !inTangent || !outTangent) return []
        return [{
          id: typeof knot.id === 'string' && knot.id ? knot.id : uuidv4(),
          position,
          inTangent,
          outTangent,
        }]
      }) : []
      detail.spatialPath = {
        kind: 'bezier',
        source: normalizeSource(path.source),
        startOutTangent,
        knots,
        endInTangent,
      }
    } else {
      // 当前 schema 不接收历史单段切线结构。
    }
  }
  return detail
}

function normalizeCameraMove(raw: unknown): StageCameraMove | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const record = raw as Record<string, unknown>
  if (record.kind === 'direct') return { kind: 'direct' }
  if (record.kind === 'dollyIn' || record.kind === 'dollyOut') {
    const distanceRatio = Number(record.distanceRatio)
    return {
      kind: record.kind,
      distanceRatio: Number.isFinite(distanceRatio) && distanceRatio >= 0 ? distanceRatio : 0.5,
    }
  }
  if (record.kind === 'orbit') {
    const degrees = Number(record.degrees)
    const direction = record.direction === 'ccw' ? 'ccw' : 'cw'
    return { kind: 'orbit', degrees: Number.isFinite(degrees) ? degrees : 0, direction }
  }
  if (record.kind === 'truck') {
    const offset = Number(record.offset)
    return { kind: 'truck', offset: Number.isFinite(offset) ? offset : 0 }
  }
  if (record.kind === 'crane') {
    const height = Number(record.height)
    return { kind: 'crane', height: Number.isFinite(height) ? height : 0 }
  }
  return undefined
}

/** 宽松解析过渡细节：结构缺失/非法时逐字段回退空值，风格对齐 sceneSerialization 的 parseAnimation */
function normalizeStateKeyframeTransition(raw: unknown): StageStateKeyframeTransition {
  const fallback: StageStateKeyframeTransition = { perObject: {} }
  if (!raw || typeof raw !== 'object') return fallback

  const record = raw as Record<string, unknown>
  const perObject: StageStateKeyframeTransition['perObject'] = {}
  if (record.perObject && typeof record.perObject === 'object') {
    for (const [objectId, detail] of Object.entries(record.perObject as Record<string, unknown>)) {
      perObject[objectId] = normalizeStateKeyframeTransitionObjectDetail(detail)
    }
  }

  return { perObject }
}

/** 宽松解析单枚状态关键帧：objectStates 内部结构信任类型转换（与 sceneSerialization 对 objects 的处理一致） */
function normalizeStateKeyframe(raw: unknown, fallbackTime: number): StageStateKeyframe | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const record = raw as Record<string, unknown>
  const hold = Number(record.hold)
  const transitionDuration = Number(record.transitionDuration)
  const time = Number(record.time)
  const objectStates =
    record.objectStates && typeof record.objectStates === 'object'
      ? (record.objectStates as Record<string, StageStateKeyframeObjectState>)
      : {}

  return {
    id: typeof record.id === 'string' && record.id ? record.id : uuidv4(),
    name: typeof record.name === 'string' && record.name ? record.name : STAGE_STATE_KEYFRAME_DEFAULT_NAME,
    time: Number.isFinite(time) && time >= 0 ? time : fallbackTime,
    continuity: record.continuity === 'smooth' ? 'smooth' : 'stop',
    hold: Number.isFinite(hold) && hold >= 0 ? hold : STAGE_STATE_KEYFRAME_DEFAULT_HOLD,
    transitionDuration:
      Number.isFinite(transitionDuration) && transitionDuration >= 0
        ? transitionDuration
        : STAGE_STATE_KEYFRAME_DEFAULT_TRANSITION_DURATION,
    objectStates,
    transition: normalizeStateKeyframeTransition(record.transition),
    // 旧工程无该字段 → null（未指定机位，沿用全局 activeCameraId，行为与改动前完全一致）
    cameraId: typeof record.cameraId === 'string' && record.cameraId ? record.cameraId : null,
  }
}

/** 宽松解析状态关键帧数组：结构缺失/非法时回退为空数组。 */
export function normalizeStateKeyframes(raw: unknown): StageStateKeyframe[] {
  if (!Array.isArray(raw)) return []
  const stateKeyframes: StageStateKeyframe[] = []
  let legacyCursor = 0
  for (const item of raw) {
    const stateKeyframe = normalizeStateKeyframe(item, legacyCursor)
    if (stateKeyframe) {
      stateKeyframes.push(stateKeyframe)
      legacyCursor = stateKeyframe.time + Math.max(0, stateKeyframe.hold) + Math.max(0, stateKeyframe.transitionDuration)
    }
  }
  return stateKeyframes.sort((a, b) => a.time - b.time)
}

