/**
 * 3D 镜头参考关键帧动画核心数据模型（纯数据，禁止 UI/渲染依赖）。
 *
 * 时间单位统一为「秒（浮点）」；fps 仅用于时间轴刻度显示与未来视频导出，不影响存储。
 * 一条轨道 = 某对象某属性路径上的一串按时间升序的关键帧；每个关键帧携带
 * 「本关键帧到下一关键帧」这段区间的缓动（速度曲线），语义对齐 AE 的分段缓动。
 */

import type { StageCameraLookAt, StageCameraRig, StageVec3 } from './sceneTypes'
import type { StageCharacterMotion } from './characterMotion'
import type { StageCameraFollow, StageSpatialPath } from './stateKeyframeTypes'

/** 关键帧可承载三类值：标量（数值）、Vec3（逐分量）、颜色（hex 字符串） */
export type StageKeyframeValue = number | StageVec3 | string

export type StageAnimatableValueType = 'scalar' | 'vec3' | 'color'

/**
 * 缓动预设名，前四种参数对齐 CSS 标准 ease 系列。cruise 是人走路的时间律：起步、停下各用一小段平滑加减速，
 * 中间匀速（见 keyframeEngine.cruiseProgress）。
 */
export type StageEasingPreset = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'cruise'

/**
 * 自定义贝塞尔缓动：等价 CSS `cubic-bezier(out[0], out[1], in[0], in[1])`。
 * out = 起点关键帧的出手柄控制点，in = 终点关键帧的入手柄控制点（语义对齐 AE）。
 */
interface StageBezierEasing {
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

/**
 * 角色的一段动作（状态关键帧编译出的运行时产物，见 characterMotionTimeline）。
 * clock 决定片段内时间怎么推进：time 按时间（(t − origin) × rate）；distance 按走过的路程
 * （startClipTime + 路程 ÷ groundSpeed，路程按固定网格取样），走跑时脚因此钉在地上。
 * 有腾空的跑步片段另带 cycle：一个周期内等分片段时间上的累计路程，着地段仍按 groundSpeed，腾空段按跑速缩短。
 */
export interface StageCharacterMotionSpan {
  startTime: number
  /** 下一段开始的时刻；最后一段为 Infinity */
  endTime: number
  motion: StageCharacterMotion
  clock:
    | { kind: 'time'; origin: number; rate: number }
    | {
      kind: 'distance'; startClipTime: number; groundSpeed: number; gridStart: number; gridStep: number; distances: number[]
      cycle?: { duration: number; distances: number[] }
    }
  /** 走跑或原地转身踩步：路程（米）、平均速度与片段放慢/加快的倍数 */
  locomotion?: { kind: 'walk' | 'turn'; distance: number; averageSpeed: number; playbackRate: number }
  /** 紧接上一段同一个走跑片段（途经卡）：相位接着走，不交叉淡入淡出 */
  continuesPrevious?: boolean
}

export interface StageCharacterMotionTimeline {
  objectId: string
  spans: StageCharacterMotionSpan[]
}

/** 角色走跑期间的朝向表（度，已解包），沿实际轨迹的前进方向。 */
export interface StageCharacterHeadingEntry {
  objectId: string
  startTime: number
  endTime: number
  gridStep: number
  yaws: number[]
}

/** 摄像机在一段时间内跟拍某个主体（由过渡细节 follow 编译而来，相邻同设置的区间合并）。 */
export interface StageCameraFollowEntry {
  cameraId: string
  startTime: number
  endTime: number
  follow: StageCameraFollow
}

/** 空间路径上的一段过渡；位置在运行时按弧长取点，不预先烤成折线。 */
export interface StageSpatialMotionSegment {
  startTime: number
  endTime: number
  from: StageVec3
  to: StageVec3
  path: StageSpatialPath
  /** 段两端都是停靠点时按该缓动走完弧长；处在平滑衔接链里时只决定链两端的出入速度。 */
  easing: StageEasingPreset
}

/** 同一对象首尾相接、在衔接点平滑通过的一串空间路径段；链内位置、速度、加速度连续。 */
export interface StageSpatialMotion {
  objectId: string
  segments: StageSpatialMotionSegment[]
  /** 摄像机的运镜设备；决定时间律与运动上限，缺省 = 不模拟设备。 */
  rig?: StageCameraRig
}

/**
 * 摄像机在一段状态关键帧区间内的朝向来源。
 * aim：两端注视同一目标，逐帧由采样位置与注视点求朝向；
 * authored：两端朝向由作者分别指定（手动注视点不同），沿用旋转轨道插值。
 */
export type StageCameraOrientationEntry =
  | { objectId: string; startTime: number; endTime: number; mode: 'aim'; lookAt: StageCameraLookAt }
  | { objectId: string; startTime: number; endTime: number; mode: 'authored' }

/** 场景级动画状态：轨道集合 + 时长 + 帧率 */
export interface StageSceneAnimation {
  tracks: StageTrack[]
  characterMotions: StageCharacterMotionTimeline[]
  characterHeadings: StageCharacterHeadingEntry[]
  spatialMotions: StageSpatialMotion[]
  cameraOrientations: StageCameraOrientationEntry[]
  cameraFollows: StageCameraFollowEntry[]
  /** 秒 */
  duration: number
  /** 仅显示/导出用 */
  fps: number
}

/** 单帧求值需要的编译产物；播放、scrub 与离屏导出共用。 */
export type StageAnimationSampleSource = Pick<StageSceneAnimation, 'tracks' | 'spatialMotions' | 'cameraOrientations'>
  & Partial<Pick<StageSceneAnimation, 'characterMotions' | 'characterHeadings' | 'cameraFollows'>>

/** 播放界面态（不进撤销历史） */
export interface StagePlaybackState {
  playing: boolean
  /** 秒 */
  currentTime: number
  loop: boolean
}

const CAMERA_STAGE_DEFAULT_DURATION = 5
export const CAMERA_STAGE_DEFAULT_FPS = 30

export function createDefaultAnimation(): StageSceneAnimation {
  return { tracks: [], characterMotions: [], characterHeadings: [], spatialMotions: [], cameraOrientations: [], cameraFollows: [], duration: CAMERA_STAGE_DEFAULT_DURATION, fps: CAMERA_STAGE_DEFAULT_FPS }
}

export function createDefaultPlayback(): StagePlaybackState {
  return { playing: false, currentTime: 0, loop: false }
}

/** 两个关键帧时间是否视为「同一个」（吸附/去重容差，避免浮点相等失败） */
export const KEYFRAME_TIME_EPSILON = 1e-4
