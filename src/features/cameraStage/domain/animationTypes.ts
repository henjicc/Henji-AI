/**
 * 3D 镜头参考关键帧动画核心数据模型（纯数据，禁止 UI/渲染依赖）。
 *
 * 时间单位统一为「秒（浮点）」；fps 仅用于时间轴刻度显示与未来视频导出，不影响存储。
 * 一条轨道 = 某对象某属性路径上的一串按时间升序的关键帧；每个关键帧携带
 * 「本关键帧到下一关键帧」这段区间的缓动（速度曲线），语义对齐 AE 的分段缓动。
 */

import type { StageVec3 } from './sceneTypes'
import type { StageCharacterMotion } from './characterMotion'

/** 关键帧可承载三类值：标量（数值）、Vec3（逐分量）、颜色（hex 字符串） */
export type StageKeyframeValue = number | StageVec3 | string

export type StageAnimatableValueType = 'scalar' | 'vec3' | 'color'

/** 缓动预设名，参数对齐 CSS 标准 ease 系列 */
export type StageEasingPreset = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'hold'

/**
 * 自定义贝塞尔缓动：等价 CSS `cubic-bezier(out[0], out[1], in[0], in[1])`。
 * out = 起点关键帧的出手柄控制点，in = 终点关键帧的入手柄控制点（语义对齐 AE）。
 */
export interface StageBezierEasing {
  type: 'bezier'
  out: [number, number]
  in: [number, number]
}

export type StageEasing = StageEasingPreset | StageBezierEasing

export interface StageKeyframe {
  /** 秒 */
  time: number
  value: StageKeyframeValue
  /** 本关键帧到下一关键帧区间的缓动；末关键帧的 easing 无意义 */
  easing: StageEasing
  /** smooth 时用相邻点计算 Hermite 切线，使速度经过本点时连续。 */
  continuity?: 'stop' | 'smooth'
}

export interface StageTrack {
  objectId: string
  /** 属性路径（如 transform.position / color / fov / pose.joints.head） */
  propertyPath: string
  /** 按 time 升序 */
  keyframes: StageKeyframe[]
}

/** 简易模式编译出的角色临时动作区间；结束后切换到目标镜头卡动作。 */
export interface StageCharacterMotionScheduleEntry {
  objectId: string
  startTime: number
  endTime: number
  motion: StageCharacterMotion
  afterMotion: StageCharacterMotion
}

export interface ResolvedCharacterMotion {
  motion: StageCharacterMotion
  timeOrigin: number
}

/** 解析指定时刻的角色动作；区间结束后沿用目标卡动作，直到后续区间覆盖。 */
export function resolveCharacterMotionAtTime(
  schedule: StageCharacterMotionScheduleEntry[],
  objectId: string,
  time: number,
  fallback: StageCharacterMotion,
): ResolvedCharacterMotion {
  let resolved: ResolvedCharacterMotion = { motion: fallback, timeOrigin: 0 }
  for (const entry of schedule) {
    if (entry.objectId !== objectId || time < entry.startTime) continue
    if (time < entry.endTime) return { motion: entry.motion, timeOrigin: entry.startTime }
    resolved = { motion: entry.afterMotion, timeOrigin: entry.endTime }
  }
  return resolved
}

/** 场景级动画状态：轨道集合 + 时长 + 帧率 */
export interface StageSceneAnimation {
  tracks: StageTrack[]
  motionSchedule: StageCharacterMotionScheduleEntry[]
  /** 秒 */
  duration: number
  /** 仅显示/导出用 */
  fps: number
}

/** 播放界面态（不进撤销历史） */
export interface StagePlaybackState {
  playing: boolean
  /** 秒 */
  currentTime: number
  loop: boolean
}

export const CAMERA_STAGE_DEFAULT_DURATION = 5
export const CAMERA_STAGE_DEFAULT_FPS = 30

export function createDefaultAnimation(): StageSceneAnimation {
  return { tracks: [], motionSchedule: [], duration: CAMERA_STAGE_DEFAULT_DURATION, fps: CAMERA_STAGE_DEFAULT_FPS }
}

export function createDefaultPlayback(): StagePlaybackState {
  return { playing: false, currentTime: 0, loop: false }
}

/** 两个关键帧时间是否视为「同一个」（吸附/去重容差，避免浮点相等失败） */
export const KEYFRAME_TIME_EPSILON = 1e-4
