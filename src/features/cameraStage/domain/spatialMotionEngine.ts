/**
 * 整镜连续轨迹（纯函数，禁止 UI/three/store 依赖）。
 *
 * 编译器把首尾相接、衔接卡为“平滑通过”的空间路径段串成一条链（StageSpatialMotion），这里把整条链
 * 当成一次运动来求值，分两步：
 *
 * 1. 几何：各段路径首尾拼成一条曲线。衔接处方向或曲率不一致时（推进接升降、升降接环绕），在衔接点前后
 *    各取 r 的弧长，用五次平滑阶跃 σ(v)=10v³−15v⁴+6v⁵ 把前一段的尾巴和后一段的开头混合起来，切掉拐角
 *    （Lloyd & Hayward 1993 的轨迹融合，同 ABB 区域转角、UR 融合半径）。σ 两端一、二阶导为零，融合段两端
 *    切线和曲率与原路径相同，整条曲线 G2，按弧长参数化后位置对弧长 C2。r 取两者较大的：设备用 blendTime 秒
 *    转过这个弯；按设备加速度上限（未指定设备按 2 米/秒²）的六成转弯所需长度（融合段峰值曲率约 1.9θ/(2r)，
 *    向心加速度 v²κ）。
 *    再限制在相邻段长的 45% 以内。衔接卡因此是途经点而不是必经点：经过衔接卡时刻的采样位置在拐角内侧，
 *    写回状态关键帧时等于采样值的分组保留卡里原值（captureObjectsIntoStateKeyframe），不会越写越偏。
 * 2. 时间律 s(t)：经过每个衔接点（融合段中点）的时刻就是状态关键帧时刻。
 *    多段链是分段五次埃尔米特，衔接点速度、加速度取三次夹持样条（限幅防倒退）的值，C2 连续且弧长单调。
 *    - 未指定设备：链首尾按速度预设停靠，加速度沿用三次样条；单段直接用速度预设缓动，与原来相同。
 *    - 指定了设备：链首尾加速度为零，起停不“拽”；单段即最小加加速度曲线（Flash & Hogan 1985 的人体运动模型）。
 *      没有用经过各衔接点的最小 jerk 样条：快慢悬殊时它在慢段里振荡得比三次样条更厉害，实测会几乎停住。
 *    各段时长与路程不成比例时，经过这些时刻的光滑曲线必然在慢段中途塌速再冲起来。这里不偷偷改时间，
 *    而是报告塌速，并给出“整条链一口气走完”时各衔接卡应在的时刻，由作者或助手决定改不改。
 *
 * 位置 C2 + 时间律 C2 ⇒ p(t)=C(s(t)) 的速度、加速度在整条链上连续，只有链首尾（真正的起点终点或显式停靠卡）
 * 才减速到零。
 */

import { easeProgress } from './keyframeEngine'
import type { StageEasingPreset, StageSpatialMotion, StageSpatialMotionSegment } from './animationTypes'
import {
  addVec3,
  createBezierArcLengthCurve,
  createParametricArcLengthCurve,
  dotVec3,
  getSpatialPathAnchors,
  lengthVec3,
  scaleVec3,
  subtractVec3,
  type ArcLengthCurve,
} from './arcLengthCurve'
import { resolveCameraRigPreset } from './cameraRigs'
import type { StageCameraRig, StageVec3 } from './sceneTypes'

interface StageMotionPeaks {
  /** 米/秒 */
  speed: number
  /** 米/秒²，含转弯的向心部分 */
  acceleration: number
  /** 米/秒³ */
  jerk: number
}

interface StageMotionSag {
  /** 速度塌得最低的时刻 */
  time: number
  speed: number
  /** 两侧最高速度中较小的那个 */
  around: number
}

export interface StageSpatialMotionTimingReport {
  rig: StageCameraRig
  startTime: number
  endTime: number
  /** 链内各衔接卡的时刻 */
  jointTimes: number[]
  /** 中途塌速（低于两侧最高速度较小者的一半）；没有时为 null */
  sag: StageMotionSag | null
  /** 整条链一口气走完时各衔接卡应在的时刻；只在塌速时给出 */
  suggestedJointTimes: number[] | null
  /** 弧长倒退（镜头往回走） */
  reverses: boolean
  withinLimits: boolean
  peaks: StageMotionPeaks
  limits: StageMotionPeaks
  /** 在设备上限内走完整条链至少需要的时长（秒）。 */
  requiredDuration: number
}

interface TimingLaw {
  /** [s, ṡ, s̈, s⃛] */
  evaluate(time: number): [number, number, number, number]
}

interface ChainRuntime {
  startTime: number
  endTime: number
  curve: ArcLengthCurve
  law: TimingLaw
  report: StageSpatialMotionTimingReport
}

interface MotionRuntime {
  chains: ChainRuntime[]
  segments: StageSpatialMotionSegment[]
}

const SLOPE_PROBE = 1e-3
const MIN_BLEND_ANGLE = 0.3 * Math.PI / 180
const BLEND_LENGTH_SHARE = 0.45
/** 转弯只用掉加速度上限的这一部分，留给沿路径的加减速。 */
const CORNER_ACCELERATION_SHARE = 0.6
/** 未指定设备时转弯按这个加速度定融合长度（米/秒²），不作为上限检查：拐角不至于甩得太急。 */
const FREE_CORNER_ACCELERATION = 2
/** 五次平滑阶跃导数的峰值 15/8：融合段峰值曲率 ≈ 1.875θ/(2r)。 */
const SMOOTH_STEP_PEAK = 1.875
/**
 * 各衔接点与链首尾的速度不超过相邻段平均速度的 2 倍：两端加速度为零的五次埃尔米特，两端速度都在
 * [0, 2 倍平均速度] 内时必然单调（v0=2、v1=0 时 p′(τ)=2(1−τ)²(1+2τ) 恰好贴着零），镜头不会往回走。
 */
const SPEED_RATIO_MAX = 2
/** 五次段倒退时把两端衔接点的加速度减半重算；仍倒退就置零，置零后由上一条保证单调。 */
const MONOTONE_REPAIR_ROUNDS = 8
const MONOTONE_SAMPLES = 256
const PROFILE_SAMPLES_PER_INTERVAL = 48
const LIMIT_TOLERANCE = 1.01
const SAG_RATIO = 0.5
const runtimeCache = new WeakMap<StageSpatialMotion, MotionRuntime>()
/** 编辑别的对象也会重编译出新的链对象，内容没变时按内容命中，免得每次重建融合几何与曲率表。 */
const runtimeByContent = new Map<string, MotionRuntime>()
const RUNTIME_CONTENT_CACHE_SIZE = 32

/** 缓动曲线两端的归一化斜率，让链首尾仍遵守该段的速度预设。 */
function easingEndSlopes(easing: StageEasingPreset): [number, number] {
  return [
    easeProgress(easing, SLOPE_PROBE) / SLOPE_PROBE,
    (1 - easeProgress(easing, 1 - SLOPE_PROBE)) / SLOPE_PROBE,
  ]
}

/* ---------------- 几何：拼接与衔接融合 ---------------- */

function smoothStep(v: number): number {
  return v * v * v * (10 + v * (-15 + 6 * v))
}

function smoothStepDerivative(v: number): number {
  return 30 * v * v * (1 - v) * (1 - v)
}

/** 端点处的曲率向量 κN：单位切线对弧长的差分。 */
function endCurvature(curve: ArcLengthCurve, side: 'start' | 'end'): StageVec3 {
  const step = Math.min(1e-3, curve.length * 1e-3)
  if (step <= 1e-12) return { x: 0, y: 0, z: 0 }
  const [a, b] = side === 'end' ? [curve.length - step, curve.length] : [0, step]
  return scaleVec3(subtractVec3(curve.tangentAt(b), curve.tangentAt(a)), 1 / step)
}

/** 衔接点是否已经切线、曲率都连续（同圆环绕接环绕、同向直线接直线），这类衔接不融合，画面与原来完全一致。 */
function needsBlend(before: ArcLengthCurve, after: ArcLengthCurve): boolean {
  const angle = Math.acos(Math.max(-1, Math.min(1, dotVec3(before.tangentAt(before.length), after.tangentAt(0)))))
  if (angle > MIN_BLEND_ANGLE) return true
  const k1 = endCurvature(before, 'end')
  const k2 = endCurvature(after, 'start')
  return lengthVec3(subtractVec3(k1, k2)) > 0.02 * Math.max(lengthVec3(k1), lengthVec3(k2)) + 1e-3
}

/**
 * 衔接融合段（切角）：参数 v∈[0,1]，前一段走最后 r、后一段走最初 r，两者按 σ 混合。
 * 只经过两端，不经过衔接点本身，拐角内侧切掉约 0.35r（90° 时）；同半径下峰值曲率约为“经过衔接点”
 * 那种融合的四分之一，镜头转弯时加速度小得多，这也是机械臂、数控按区域转角时的走法。
 */
function createBlendCurve(before: ArcLengthCurve, after: ArcLengthCurve, radius: number) {
  const startDistance = before.length - radius
  const frames = (v: number) => ({
    a: before.pointAt(startDistance + v * radius),
    ta: before.tangentAt(startDistance + v * radius),
    b: after.pointAt(v * radius),
    tb: after.tangentAt(v * radius),
  })
  return createParametricArcLengthCurve(
    1,
    (v) => {
      const { a, b } = frames(v)
      return addVec3(a, scaleVec3(subtractVec3(b, a), smoothStep(v)))
    },
    (v) => {
      const { a, ta, b, tb } = frames(v)
      const sigma = smoothStep(v)
      return addVec3(
        addVec3(scaleVec3(ta, (1 - sigma) * radius), scaleVec3(tb, sigma * radius)),
        scaleVec3(subtractVec3(b, a), smoothStepDerivative(v)),
      )
    },
  )
}

interface CompositePiece {
  start: number
  length: number
  pointAt(distance: number): StageVec3
  tangentAt(distance: number): StageVec3
}

function compositeCurve(pieces: CompositePiece[]): ArcLengthCurve {
  const length = pieces.reduce((total, piece) => total + piece.length, 0)
  const pieceAt = (distance: number): [CompositePiece, number] => {
    const clamped = Math.max(0, Math.min(length, distance))
    let low = 0
    let high = pieces.length - 1
    while (low < high) {
      const middle = (low + high + 1) >> 1
      if (pieces[middle].start <= clamped) low = middle
      else high = middle - 1
    }
    const piece = pieces[low]
    return [piece, Math.min(piece.length, clamped - piece.start)]
  }
  return {
    length,
    pointAt: (distance) => {
      const [piece, local] = pieceAt(distance)
      return piece.pointAt(local)
    },
    tangentAt: (distance) => {
      const [piece, local] = pieceAt(distance)
      return piece.tangentAt(local)
    },
  }
}

interface ChainGeometry {
  curve: ArcLengthCurve
  /** 链起点、各衔接点、终点在整条曲线上的弧长。 */
  viaDistances: number[]
}

function buildChainGeometry(
  segments: StageSpatialMotionSegment[],
  curves: ArcLengthCurve[],
  blendTime: number,
  maxAcceleration: number,
): ChainGeometry {
  const count = curves.length
  const radii: number[] = []
  for (let joint = 0; joint < count - 1; joint += 1) {
    const before = curves[joint]
    const after = curves[joint + 1]
    if (!needsBlend(before, after)) {
      radii.push(0)
      continue
    }
    const spans = segments[joint].endTime - segments[joint].startTime + segments[joint + 1].endTime - segments[joint + 1].startTime
    const jointSpeed = (before.length + after.length) / Math.max(1e-6, spans)
    const turn = Math.acos(Math.max(-1, Math.min(1, dotVec3(before.tangentAt(before.length), after.tangentAt(0)))))
    const byTime = 0.5 * blendTime * jointSpeed
    const byAcceleration = SMOOTH_STEP_PEAK * turn * jointSpeed * jointSpeed / (2 * CORNER_ACCELERATION_SHARE * maxAcceleration)
    radii.push(Math.min(Math.max(byTime, byAcceleration), BLEND_LENGTH_SHARE * before.length, BLEND_LENGTH_SHARE * after.length))
  }

  const pieces: CompositePiece[] = []
  const viaDistances = [0]
  let cursor = 0
  for (let index = 0; index < count; index += 1) {
    const curve = curves[index]
    const coreStart = index > 0 ? radii[index - 1] : 0
    const coreEnd = curve.length - (index < count - 1 ? radii[index] : 0)
    const coreLength = Math.max(0, coreEnd - coreStart)
    pieces.push({
      start: cursor,
      length: coreLength,
      pointAt: (local) => curve.pointAt(coreStart + local),
      tangentAt: (local) => curve.tangentAt(coreStart + local),
    })
    cursor += coreLength
    if (index === count - 1) break
    const radius = radii[index]
    if (radius <= 1e-9) {
      viaDistances.push(cursor)
      continue
    }
    const blend = createBlendCurve(curve, curves[index + 1], radius)
    pieces.push({ start: cursor, length: blend.length, pointAt: blend.pointAt, tangentAt: blend.tangentAt })
    viaDistances.push(cursor + blend.distanceAtParam(0.5))
    cursor += blend.length
  }
  viaDistances.push(cursor)
  return { curve: compositeCurve(pieces), viaDistances }
}

/* ---------------- 时间律 ---------------- */

interface PolynomialInterval {
  startTime: number
  span: number
  /** 归一化时间 τ=(t−start)/span 的多项式系数，次数从低到高 */
  coefficients: number[]
}

function polynomialLaw(intervals: PolynomialInterval[]): TimingLaw {
  return {
    evaluate: (time) => {
      let index = 0
      while (index < intervals.length - 1 && time > intervals[index].startTime + intervals[index].span) index += 1
      const { startTime, span, coefficients } = intervals[index]
      const tau = Math.max(0, Math.min(1, (time - startTime) / span))
      let s = 0
      let v = 0
      let a = 0
      let j = 0
      for (let power = coefficients.length - 1; power >= 0; power -= 1) {
        const c = coefficients[power]
        s = s * tau + c
        if (power >= 1) v = v * tau + power * c
        if (power >= 2) a = a * tau + power * (power - 1) * c
        if (power >= 3) j = j * tau + power * (power - 1) * (power - 2) * c
      }
      return [s, v / span, a / (span * span), j / (span * span * span)]
    },
  }
}

function easingLaw(length: number, startTime: number, endTime: number, easing: StageEasingPreset): TimingLaw {
  const span = endTime - startTime
  const at = (time: number): number => length * easeProgress(easing, Math.max(0, Math.min(1, (time - startTime) / span)), span)
  const step = Math.min(1e-3, span / 100)
  return {
    evaluate: (time) => {
      const values = [-1.5, -0.5, 0.5, 1.5].map((offset) => at(time + offset * step))
      return [
        at(time),
        (values[2] - values[1]) / step,
        (values[3] - values[2] - values[1] + values[0]) / (2 * step * step),
        (values[3] - 3 * values[2] + 3 * values[1] - values[0]) / (step * step * step),
      ]
    },
  }
}

/**
 * 三次夹持样条在各衔接点的速度：首尾速度给定，Thomas 算法解内部衔接点，再按 Fritsch-Carlson 的做法限幅，
 * 上限取两侧平均速度较小者的 SPEED_RATIO_MAX 倍（比三次样条单调所需的 3 倍更紧，五次段才能保证单调）。
 */
function clampedCubicKnotSpeeds(spans: number[], distances: number[], startSpeed: number, endSpeed: number): number[] {
  const count = spans.length
  const secants = spans.map((span, index) => (distances[index + 1] - distances[index]) / span)
  const speeds = new Array<number>(count + 1).fill(0)
  speeds[0] = startSpeed
  speeds[count] = endSpeed
  const upper: number[] = []
  const rhs: number[] = []
  for (let joint = 1; joint < count; joint += 1) {
    const before = spans[joint - 1]
    const after = spans[joint]
    let diagonal = 2 * (before + after)
    let value = 3 * (after * secants[joint - 1] + before * secants[joint])
    if (joint === 1) value -= after * speeds[0]
    if (joint === count - 1) value -= before * speeds[count]
    if (joint > 1) {
      diagonal -= after * upper[joint - 2]
      value -= after * rhs[joint - 2]
    }
    upper.push(before / diagonal)
    rhs.push(value / diagonal)
  }
  for (let joint = count - 1; joint >= 1; joint -= 1) {
    speeds[joint] = rhs[joint - 1] - (joint < count - 1 ? upper[joint - 1] * speeds[joint + 1] : 0)
  }
  for (let joint = 1; joint < count; joint += 1) {
    const limit = SPEED_RATIO_MAX * Math.min(secants[joint - 1], secants[joint])
    speeds[joint] = limit <= 1e-8 ? 0 : Math.max(0, Math.min(speeds[joint], limit))
  }
  return speeds
}

function cubicIntervals(times: number[], distances: number[], speeds: number[]): PolynomialInterval[] {
  return times.slice(0, -1).map((startTime, index) => {
    const span = times[index + 1] - startTime
    const delta = distances[index + 1] - distances[index]
    const v0 = speeds[index] * span
    const v1 = speeds[index + 1] * span
    return { startTime, span, coefficients: [distances[index], v0, 3 * delta - 2 * v0 - v1, -2 * delta + v0 + v1] }
  })
}

/** 五次埃尔米特：两端给定位置、速度、加速度。 */
function quinticCoefficients(x0: number, v0: number, a0: number, x1: number, v1: number, a1: number, span: number): number[] {
  const delta = x1 - x0
  const h2 = span * span
  return [
    x0,
    v0 * span,
    a0 * h2 / 2,
    10 * delta - (6 * v0 + 4 * v1) * span - (3 * a0 - a1) * h2 / 2,
    -15 * delta + (8 * v0 + 7 * v1) * span + (3 * a0 - 2 * a1) * h2 / 2,
    6 * delta - 3 * (v0 + v1) * span - (a0 - a1) * h2 / 2,
  ]
}

/**
 * 链的时间律：分段五次埃尔米特，衔接点速度、加速度取三次夹持样条的值，所以衔接点处速度、加速度都连续。
 * 样条没被限幅时这就是三次样条本身（五次埃尔米特在两端取同一条三次的导数时退化为它）；
 * 限幅让衔接点两侧加速度不等时取平均，仍保持 C2。取平均后的五次段可能冲过头往回走：这时把该段两端衔接点的
 * 加速度减半重算，几轮后仍倒退就置零（相邻段共用同一个值，仍是 C2），两端加速度为零时由速度上限保证单调。
 * 链首尾加速度：未指定设备沿用三次样条的值（与原来一致），设备取零，起停不“拽”。
 * 单段设备链因此就是两端速度、加速度为零的最小加加速度曲线。
 */
function splineLaw(times: number[], distances: number[], startSpeed: number, endSpeed: number, endAcceleration: 'cubic' | 'zero'): TimingLaw {
  const spans = times.slice(1).map((time, index) => time - times[index])
  const speeds = clampedCubicKnotSpeeds(spans, distances, startSpeed, endSpeed)
  const cubic = cubicIntervals(times, distances, speeds)
  const startOf = (interval: PolynomialInterval): number => 2 * interval.coefficients[2] / (interval.span * interval.span)
  const endOf = (interval: PolynomialInterval): number => (2 * interval.coefficients[2] + 6 * interval.coefficients[3]) / (interval.span * interval.span)
  const last = spans.length
  const accelerations = speeds.map((_, knot) => {
    if (knot === 0) return endAcceleration === 'zero' ? 0 : startOf(cubic[0])
    if (knot === last) return endAcceleration === 'zero' ? 0 : endOf(cubic[last - 1])
    // 速度被限到零的衔接点加速度也得是零，否则它的一侧必然往回走。
    if (speeds[knot] <= 1e-12) return 0
    return (endOf(cubic[knot - 1]) + startOf(cubic[knot])) / 2
  })
  const intervalAt = (index: number): PolynomialInterval => ({
    startTime: times[index],
    span: spans[index],
    coefficients: quinticCoefficients(
      distances[index], speeds[index], accelerations[index],
      distances[index + 1], speeds[index + 1], accelerations[index + 1],
      spans[index],
    ),
  })
  const reverses = (interval: PolynomialInterval): boolean => {
    const c = interval.coefficients
    const tolerance = -1e-9 * Math.max(1e-9, Math.abs(c[1] + c[2] + c[3] + c[4] + c[5]))
    for (let sample = 0; sample <= MONOTONE_SAMPLES; sample += 1) {
      const tau = sample / MONOTONE_SAMPLES
      if (c[1] + tau * (2 * c[2] + tau * (3 * c[3] + tau * (4 * c[4] + tau * 5 * c[5]))) < tolerance) return true
    }
    return false
  }
  const failingIntervals = (): number[] => spans.map((_, index) => index).filter((index) => reverses(intervalAt(index)))
  for (let round = 0; round < MONOTONE_REPAIR_ROUNDS; round += 1) {
    const failing = failingIntervals()
    if (failing.length === 0) break
    for (const index of failing) for (const knot of [index, index + 1]) accelerations[knot] /= 2
  }
  // 置零会改到共用这个衔接点的相邻段，所以反复查到没有倒退为止；全部置零时由速度上限保证单调，循环必然结束。
  for (let failing = failingIntervals(); failing.length > 0; failing = failingIntervals()) {
    for (const index of failing) for (const knot of [index, index + 1]) accelerations[knot] = 0
  }
  return polynomialLaw(spans.map((_, index) => intervalAt(index)))
}

/* ---------------- 设备上限与塌速检查 ---------------- */

function curvatureTable(curve: ArcLengthCurve): (distance: number) => [number, number] {
  const count = Math.max(64, Math.min(1024, Math.ceil(curve.length / 0.02)))
  const step = curve.length / count
  const tangents = Array.from({ length: count + 1 }, (_, index) => curve.tangentAt(index * step))
  const curvatures = tangents.map((_, index) => {
    const before = tangents[Math.max(0, index - 1)]
    const after = tangents[Math.min(count, index + 1)]
    const width = (Math.min(count, index + 1) - Math.max(0, index - 1)) * step
    return width <= 1e-12 ? 0 : lengthVec3(subtractVec3(after, before)) / width
  })
  return (distance) => {
    if (step <= 1e-12) return [0, 0]
    const position = Math.max(0, Math.min(count, distance / step))
    const index = Math.min(count - 1, Math.floor(position))
    const ratio = position - index
    const kappa = curvatures[index] + (curvatures[index + 1] - curvatures[index]) * ratio
    return [kappa, (curvatures[index + 1] - curvatures[index]) / step]
  }
}

interface ProfileCheck {
  peaks: StageMotionPeaks
  reverses: boolean
  sag: StageMotionSag | null
}

/** 按 Frenet 分解求三维速度、加速度、加加速度的峰值：a = s̈T + κṡ²N，j ≈ (s⃛−κ²ṡ³)T + (3κṡs̈+κ′ṡ³)N。 */
function checkProfile(law: TimingLaw, times: number[], curvature: (distance: number) => [number, number]): ProfileCheck {
  const peaks: StageMotionPeaks = { speed: 0, acceleration: 0, jerk: 0 }
  const samples: Array<{ time: number; speed: number }> = []
  for (let interval = 0; interval < times.length - 1; interval += 1) {
    const span = times[interval + 1] - times[interval]
    for (let sample = interval === 0 ? 0 : 1; sample <= PROFILE_SAMPLES_PER_INTERVAL; sample += 1) {
      const time = times[interval] + span * sample / PROFILE_SAMPLES_PER_INTERVAL
      const [s, v, a, j] = law.evaluate(time)
      const [kappa, kappaSlope] = curvature(s)
      samples.push({ time, speed: v })
      peaks.speed = Math.max(peaks.speed, Math.abs(v))
      peaks.acceleration = Math.max(peaks.acceleration, Math.hypot(a, kappa * v * v))
      peaks.jerk = Math.max(peaks.jerk, Math.hypot(j - kappa * kappa * v * v * v, 3 * kappa * v * a + kappaSlope * v * v * v))
    }
  }
  const suffixMax = new Array<number>(samples.length).fill(0)
  for (let index = samples.length - 2; index >= 0; index -= 1) suffixMax[index] = Math.max(suffixMax[index + 1], samples[index + 1].speed)
  let prefixMax = 0
  let sag: StageMotionSag | null = null
  for (let index = 1; index < samples.length - 1; index += 1) {
    prefixMax = Math.max(prefixMax, samples[index - 1].speed)
    const around = Math.min(prefixMax, suffixMax[index])
    if (samples[index].speed < SAG_RATIO * around && (!sag || samples[index].speed / around < sag.speed / sag.around)) {
      sag = { time: samples[index].time, speed: samples[index].speed, around }
    }
  }
  return {
    peaks,
    reverses: Math.min(...samples.map((item) => item.speed)) < -1e-6 * Math.max(1, peaks.speed),
    sag,
  }
}

function withinLimits(peaks: StageMotionPeaks, limits: StageMotionPeaks): boolean {
  return peaks.speed <= limits.speed * LIMIT_TOLERANCE
    && peaks.acceleration <= limits.acceleration * LIMIT_TOLERANCE
    && peaks.jerk <= limits.jerk * LIMIT_TOLERANCE
}

/** 整体时间伸缩时速度、加速度、加加速度分别按 1/T、1/T²、1/T³ 变化，由此反推满足上限的最短时长。 */
function requiredDuration(duration: number, peaks: StageMotionPeaks, limits: StageMotionPeaks): number {
  return duration * Math.max(
    1,
    peaks.speed / limits.speed,
    Math.sqrt(peaks.acceleration / limits.acceleration),
    Math.cbrt(peaks.jerk / limits.jerk),
  )
}

/**
 * 整条链当成一个动作走完时各衔接点的经过时刻：首尾速度取自速度预设、加速度为零的单段五次曲线，
 * 即没有中间约束时 ∫jerk² 最小的走法（Flash & Hogan 1985 把经过时刻也当作优化量时的解）。
 */
function singleGestureTimes(distances: number[], startTime: number, endTime: number, startSpeed: number, endSpeed: number): number[] {
  const total = distances[distances.length - 1]
  const span = endTime - startTime
  const law = polynomialLaw([{ startTime, span, coefficients: quinticCoefficients(0, startSpeed, 0, total, endSpeed, 0, span) }])
  return distances.slice(1, -1).map((distance) => {
    let low = startTime
    let high = endTime
    for (let iteration = 0; iteration < 48; iteration += 1) {
      const middle = (low + high) / 2
      if (law.evaluate(middle)[0] < distance) low = middle
      else high = middle
    }
    return (low + high) / 2
  })
}

/* ---------------- 链的组装 ---------------- */

function buildChain(segments: StageSpatialMotionSegment[], curves: ArcLengthCurve[], rig: StageCameraRig): ChainRuntime {
  const preset = resolveCameraRigPreset(rig)
  const startTime = segments[0].startTime
  const endTime = segments[segments.length - 1].endTime
  const times = [startTime, ...segments.map((segment) => segment.endTime)]
  const limits: StageMotionPeaks = { speed: preset.maxSpeed, acceleration: preset.maxAcceleration, jerk: preset.maxJerk }
  const [startSlope] = easingEndSlopes(segments[0].easing)
  const [, endSlope] = easingEndSlopes(segments[segments.length - 1].easing)
  const report = (check: ProfileCheck, suggestedJointTimes: number[] | null): StageSpatialMotionTimingReport => ({
    rig,
    startTime,
    endTime,
    jointTimes: times.slice(1, -1),
    sag: check.sag,
    suggestedJointTimes: check.sag ? suggestedJointTimes : null,
    reverses: check.reverses,
    withinLimits: withinLimits(check.peaks, limits),
    peaks: check.peaks,
    limits,
    requiredDuration: requiredDuration(endTime - startTime, check.peaks, limits),
  })

  if (segments.length === 1 && rig === 'free') {
    const curve = curves[0]
    const law = easingLaw(curve.length, startTime, endTime, segments[0].easing)
    return { startTime, endTime, curve, law, report: report(checkProfile(law, times, curvatureTable(curve)), null) }
  }

  const cornerAcceleration = Number.isFinite(preset.maxAcceleration) ? preset.maxAcceleration : FREE_CORNER_ACCELERATION
  const geometry = buildChainGeometry(segments, curves, preset.blendTime, cornerAcceleration)
  const distances = geometry.viaDistances
  const secant = (index: number): number => (distances[index + 1] - distances[index]) / (times[index + 1] - times[index])
  const startSpeed = Math.min(startSlope, SPEED_RATIO_MAX) * secant(0)
  const endSpeed = Math.min(endSlope, SPEED_RATIO_MAX) * secant(segments.length - 1)
  const law = splineLaw(times, distances, startSpeed, endSpeed, rig === 'free' ? 'cubic' : 'zero')
  const total = distances[distances.length - 1]
  const span = endTime - startTime
  const suggested = segments.length > 1
    ? singleGestureTimes(distances, startTime, endTime, Math.min(startSlope, SPEED_RATIO_MAX) * total / span, Math.min(endSlope, SPEED_RATIO_MAX) * total / span)
    : null
  return { startTime, endTime, curve: geometry.curve, law, report: report(checkProfile(law, times, curvatureTable(geometry.curve)), suggested) }
}

/** 长度或时长为零的段（原地不动、瞬间跳位）把链断开：链内经过它就要减速到零，按两条链各自起停。 */
function buildMotionRuntime(motion: StageSpatialMotion): MotionRuntime {
  const rig = motion.rig ?? 'free'
  const chains: ChainRuntime[] = []
  let pendingSegments: StageSpatialMotionSegment[] = []
  let pendingCurves: ArcLengthCurve[] = []
  const flush = (): void => {
    if (pendingSegments.length > 0) chains.push(buildChain(pendingSegments, pendingCurves, rig))
    pendingSegments = []
    pendingCurves = []
  }
  for (const segment of motion.segments) {
    const curve = createBezierArcLengthCurve(getSpatialPathAnchors(segment.from, segment.to, segment.path))
    if (curve.length <= 1e-6 || segment.endTime - segment.startTime <= 1e-6) {
      flush()
      continue
    }
    pendingSegments.push(segment)
    pendingCurves.push(curve)
  }
  flush()
  return { chains, segments: motion.segments }
}

function runtimeOf(motion: StageSpatialMotion): MotionRuntime {
  let runtime = runtimeCache.get(motion)
  if (runtime) return runtime
  const key = JSON.stringify(motion)
  runtime = runtimeByContent.get(key)
  if (!runtime) {
    runtime = buildMotionRuntime(motion)
    if (runtimeByContent.size >= RUNTIME_CONTENT_CACHE_SIZE) runtimeByContent.delete(runtimeByContent.keys().next().value as string)
    runtimeByContent.set(key, runtime)
  }
  runtimeCache.set(motion, runtime)
  return runtime
}

/**
 * 在空间路径链上按时间取位置；时间不在链的区间内时返回 undefined，由轨道端点值负责。
 * 运行时结构按链对象缓存：编译产物不变时，逐帧求值只做查找与求值。
 */
export function sampleSpatialMotion(motion: StageSpatialMotion, time: number): StageVec3 | undefined {
  const first = motion.segments[0]
  const last = motion.segments[motion.segments.length - 1]
  if (!first || !last || time < first.startTime || time > last.endTime) return undefined
  const runtime = runtimeOf(motion)
  const chain = runtime.chains.find((item) => time >= item.startTime && time <= item.endTime)
  if (!chain) {
    const segment = runtime.segments.find((item) => time >= item.startTime && time <= item.endTime) ?? first
    return { ...(time >= segment.endTime ? segment.to : segment.from) }
  }
  const [distance] = chain.law.evaluate(time)
  return chain.curve.pointAt(distance)
}

/** 链的时间分配、塌速与设备上限检查结果，供运镜结果自检。 */
export function describeSpatialMotionTiming(motion: StageSpatialMotion): StageSpatialMotionTimingReport[] {
  return runtimeOf(motion).chains.map((chain) => chain.report)
}
