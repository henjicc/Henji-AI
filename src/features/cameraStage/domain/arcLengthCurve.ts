/**
 * 按弧长取点的参数曲线（纯函数，禁止 UI/three 依赖）。
 *
 * 弧长表只用来给牛顿迭代定初值：每一步用 5 点高斯-勒让德求积算 ∫|C'|，再用 |C'| 做导数反解参数，
 * 结果是精确的弧长参数化（误差 1e-10 量级）。只靠弧长表线性插值时，du/ds 在表格节点处分段为常数，
 * 速度看不出来，但加速度、加加速度会在每个节点上冒尖，平滑度度量就失真了。
 */

import type { StageVec3 } from './sceneTypes'
import type { StageSpatialPath } from './stateKeyframeTypes'

export interface PathAnchor {
  position: StageVec3
  inTangent: StageVec3
  outTangent: StageVec3
}

export interface ArcLengthCurve {
  length: number
  pointAt(distance: number): StageVec3
  /** 单位切线；曲线退化为一点时返回零向量。 */
  tangentAt(distance: number): StageVec3
}

const ZERO_VEC3: StageVec3 = { x: 0, y: 0, z: 0 }
const GAUSS_NODES = [-0.906179845938664, -0.5384693101056831, 0, 0.5384693101056831, 0.906179845938664]
const GAUSS_WEIGHTS = [0.2369268850561891, 0.4786286704993665, 0.5688888888888889, 0.4786286704993665, 0.2369268850561891]
const STEPS_PER_PIECE = 32
const NEWTON_ITERATIONS = 12

export function addVec3(a: StageVec3, b: StageVec3): StageVec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

export function subtractVec3(a: StageVec3, b: StageVec3): StageVec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

export function scaleVec3(value: StageVec3, factor: number): StageVec3 {
  return { x: value.x * factor, y: value.y * factor, z: value.z * factor }
}

export function lengthVec3(value: StageVec3): number {
  return Math.hypot(value.x, value.y, value.z)
}

export function dotVec3(a: StageVec3, b: StageVec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function normalizeVec3(value: StageVec3): StageVec3 {
  const length = lengthVec3(value)
  return length <= 1e-12 ? { ...ZERO_VEC3 } : scaleVec3(value, 1 / length)
}

export function getSpatialPathAnchors(from: StageVec3, to: StageVec3, path: StageSpatialPath): PathAnchor[] {
  return [
    { position: from, inTangent: ZERO_VEC3, outTangent: path.startOutTangent },
    ...path.knots.map((knot) => ({
      position: knot.position,
      inTangent: knot.inTangent,
      outTangent: knot.outTangent,
    })),
    { position: to, inTangent: path.endInTangent, outTangent: ZERO_VEC3 },
  ]
}

export function cubicSegmentPoint(start: PathAnchor, end: PathAnchor, t: number): StageVec3 {
  const u = Math.max(0, Math.min(1, t))
  const inverse = 1 - u
  const control1 = addVec3(start.position, start.outTangent)
  const control2 = addVec3(end.position, end.inTangent)
  const component = (a: number, b: number, c: number, d: number): number => (
    inverse ** 3 * a + 3 * inverse ** 2 * u * b + 3 * inverse * u ** 2 * c + u ** 3 * d
  )
  return {
    x: component(start.position.x, control1.x, control2.x, end.position.x),
    y: component(start.position.y, control1.y, control2.y, end.position.y),
    z: component(start.position.z, control1.z, control2.z, end.position.z),
  }
}

function cubicSegmentDerivative(start: PathAnchor, end: PathAnchor, t: number): StageVec3 {
  const u = Math.max(0, Math.min(1, t))
  const inverse = 1 - u
  const control1 = addVec3(start.position, start.outTangent)
  const control2 = addVec3(end.position, end.inTangent)
  const component = (a: number, b: number, c: number, d: number): number => (
    3 * inverse ** 2 * (b - a) + 6 * inverse * u * (c - b) + 3 * u ** 2 * (d - c)
  )
  return {
    x: component(start.position.x, control1.x, control2.x, end.position.x),
    y: component(start.position.y, control1.y, control2.y, end.position.y),
    z: component(start.position.z, control1.z, control2.z, end.position.z),
  }
}

/**
 * 参数 v ∈ [0, pieceCount] 的曲线，按弧长反解。point/derivative 由调用方给出（贝塞尔段、衔接融合段共用）。
 */
export function createParametricArcLengthCurve(
  pieceCount: number,
  point: (v: number) => StageVec3,
  derivative: (v: number) => StageVec3,
): ArcLengthCurve & { distanceAtParam(v: number): number } {
  const speed = (v: number): number => lengthVec3(derivative(v))
  const integrate = (a: number, b: number): number => {
    const half = (b - a) / 2
    const middle = (a + b) / 2
    let sum = 0
    for (let index = 0; index < GAUSS_NODES.length; index += 1) {
      sum += GAUSS_WEIGHTS[index] * speed(middle + half * GAUSS_NODES[index])
    }
    return sum * half
  }
  const steps = Math.max(1, pieceCount) * STEPS_PER_PIECE
  const params: number[] = [0]
  const distances: number[] = [0]
  for (let step = 1; step <= steps; step += 1) {
    const v = pieceCount * step / steps
    distances.push(distances[step - 1] + integrate(params[step - 1], v))
    params.push(v)
  }
  const length = distances[steps]

  const paramAt = (distance: number): number => {
    if (length <= 1e-12) return 0
    const target = Math.max(0, Math.min(length, distance))
    let low = 0
    let high = steps
    while (high - low > 1) {
      const middle = (low + high) >> 1
      if (distances[middle] <= target) low = middle
      else high = middle
    }
    let lo = params[low]
    let hi = params[high]
    const base = distances[low]
    const span = distances[high] - base
    let v = span <= 1e-15 ? lo : lo + (hi - lo) * (target - base) / span
    for (let iteration = 0; iteration < NEWTON_ITERATIONS; iteration += 1) {
      const error = base + integrate(params[low], v) - target
      if (Math.abs(error) <= 1e-12 * Math.max(1, length)) break
      if (error > 0) hi = v
      else lo = v
      const slope = speed(v)
      const next = slope > 1e-12 ? v - error / slope : (lo + hi) / 2
      v = next > lo && next < hi ? next : (lo + hi) / 2
    }
    return v
  }

  return {
    length,
    distanceAtParam: (v) => {
      const clamped = Math.max(0, Math.min(pieceCount, v))
      const index = Math.min(steps - 1, Math.floor(clamped / pieceCount * steps))
      return distances[index] + integrate(params[index], clamped)
    },
    pointAt: (distance) => point(paramAt(distance)),
    tangentAt: (distance) => {
      const v = paramAt(distance)
      const tangent = normalizeVec3(derivative(v))
      if (lengthVec3(tangent) > 0 || length <= 1e-12) return tangent
      // 切线为零的端点（手柄收进锚点）：取紧邻一侧的割线方向。
      const probe = Math.min(length, Math.max(0, distance)) + (distance >= length ? -1e-6 : 1e-6) * Math.max(1, length)
      const offset = subtractVec3(point(paramAt(probe)), point(v))
      return normalizeVec3(distance >= length ? scaleVec3(offset, -1) : offset)
    },
  }
}

/** 分段三次贝塞尔路径的弧长曲线。 */
export function createBezierArcLengthCurve(anchors: PathAnchor[]): ArcLengthCurve {
  const pieceCount = Math.max(1, anchors.length - 1)
  const pieceOf = (v: number): [number, number] => {
    const index = Math.min(pieceCount - 1, Math.max(0, Math.floor(v)))
    return [index, v - index]
  }
  if (anchors.length < 2) {
    const position = anchors[0]?.position ?? ZERO_VEC3
    return { length: 0, pointAt: () => ({ ...position }), tangentAt: () => ({ ...ZERO_VEC3 }) }
  }
  return createParametricArcLengthCurve(
    pieceCount,
    (v) => {
      const [index, t] = pieceOf(v)
      return cubicSegmentPoint(anchors[index], anchors[index + 1], t)
    },
    (v) => {
      const [index, t] = pieceOf(v)
      return cubicSegmentDerivative(anchors[index], anchors[index + 1], t)
    },
  )
}
