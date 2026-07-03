/**
 * 关键帧插值与采样纯函数内核（可单测，禁止 UI/渲染依赖）。
 *
 * 求值链路：给定时间 t → 二分定位相邻关键帧 → 归一化区间时间 u →
 * 过分段缓动曲线得缓动进度 f → 按值类型（标量/Vec3/颜色）插值。
 * 缓动求值等价 CSS `cubic-bezier(x1,y1,x2,y2)`（牛顿迭代 + 二分回退）。
 */

import {
  KEYFRAME_TIME_EPSILON,
  type StageAnimatableValueType,
  type StageEasing,
  type StageKeyframe,
  type StageKeyframeValue,
  type StageTrack,
} from './animationTypes'
import type { StageVec3 } from './sceneTypes'

/** 缓动预设 → cubic-bezier 控制点（对齐 CSS 标准 ease 系列） */
const EASING_PRESET_BEZIER: Record<string, [number, number, number, number]> = {
  linear: [0, 0, 1, 1],
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
}

export function resolveEasingControlPoints(easing: StageEasing): [number, number, number, number] {
  if (typeof easing === 'string') {
    return EASING_PRESET_BEZIER[easing] ?? EASING_PRESET_BEZIER.linear
  }
  return [easing.out[0], easing.out[1], easing.in[0], easing.in[1]]
}

/** 一维三次贝塞尔（端点固定 0、1，两个控制点为 c1/c2）在参数 t∈[0,1] 处取值 */
function bezierAxis(c1: number, c2: number, t: number): number {
  const mt = 1 - t
  // B(t) = 3(1-t)^2 t c1 + 3(1-t) t^2 c2 + t^3   （端点 0 和 1）
  return 3 * mt * mt * t * c1 + 3 * mt * t * t * c2 + t * t * t
}

function bezierAxisDerivative(c1: number, c2: number, t: number): number {
  const mt = 1 - t
  return 3 * mt * mt * c1 + 6 * mt * t * (c2 - c1) + 3 * t * t * (1 - c2)
}

/**
 * 求 cubic-bezier 在给定归一化时间 x（∈[0,1]）处的缓动进度 y。
 * 先由 x 解出参数 t（牛顿迭代，失败回退二分），再代入 y 轴曲线。
 */
export function cubicBezierEase(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x: number,
): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  // 线性快路：控制点落在对角线上
  if (x1 === y1 && x2 === y2) return x

  let t = x
  for (let i = 0; i < 8; i += 1) {
    const xEst = bezierAxis(x1, x2, t) - x
    if (Math.abs(xEst) < 1e-6) {
      return bezierAxis(y1, y2, t)
    }
    const dx = bezierAxisDerivative(x1, x2, t)
    if (Math.abs(dx) < 1e-6) break
    t -= xEst / dx
  }

  // 二分回退，保证收敛
  let lo = 0
  let hi = 1
  t = x
  for (let i = 0; i < 40; i += 1) {
    const xEst = bezierAxis(x1, x2, t)
    if (Math.abs(xEst - x) < 1e-6) break
    if (xEst < x) lo = t
    else hi = t
    t = (lo + hi) / 2
  }
  return bezierAxis(y1, y2, t)
}

export function easeProgress(easing: StageEasing, u: number): number {
  const [x1, y1, x2, y2] = resolveEasingControlPoints(easing)
  return cubicBezierEase(x1, y1, x2, y2, u)
}

/* ---------- 值插值 ---------- */

function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f
}

function lerpVec3(a: StageVec3, b: StageVec3, f: number): StageVec3 {
  return { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f), z: lerp(a.z, b.z, f) }
}

/** #rgb / #rrggbb → [r,g,b]（0~255） */
export function parseHexColor(hex: string): [number, number, number] {
  let value = hex.trim().replace(/^#/, '')
  if (value.length === 3) {
    value = value
      .split('')
      .map((ch) => ch + ch)
      .join('')
  }
  const int = Number.parseInt(value, 16)
  if (!Number.isFinite(int)) return [0, 0, 0]
  return [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff]
}

function toHexColor(r: number, g: number, b: number): string {
  const clamp = (n: number): number => Math.max(0, Math.min(255, Math.round(n)))
  const toHex = (n: number): string => clamp(n).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function lerpColor(a: string, b: string, f: number): string {
  const [ar, ag, ab] = parseHexColor(a)
  const [br, bg, bb] = parseHexColor(b)
  return toHexColor(lerp(ar, br, f), lerp(ag, bg, f), lerp(ab, bb, f))
}

export function interpolateValue(
  a: StageKeyframeValue,
  b: StageKeyframeValue,
  f: number,
  type: StageAnimatableValueType,
): StageKeyframeValue {
  if (type === 'scalar') return lerp(a as number, b as number, f)
  if (type === 'color') return lerpColor(a as string, b as string, f)
  return lerpVec3(a as StageVec3, b as StageVec3, f)
}

/* ---------- 轨道采样 ---------- */

/** 二分查找：返回最后一个 time <= target 的关键帧下标，全部大于 target 时返回 -1 */
function findSegmentIndex(keyframes: StageKeyframe[], target: number): number {
  let lo = 0
  let hi = keyframes.length - 1
  let result = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (keyframes[mid].time <= target) {
      result = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return result
}

/**
 * 在给定时间采样一条轨道的值。
 * 边界规则：首关键帧前取首值、末关键帧后取末值、单关键帧恒值、空轨道返回 undefined。
 */
export function sampleTrack(
  track: StageTrack,
  time: number,
  type: StageAnimatableValueType,
): StageKeyframeValue | undefined {
  const { keyframes } = track
  if (keyframes.length === 0) return undefined
  if (keyframes.length === 1) return keyframes[0].value
  if (time <= keyframes[0].time) return keyframes[0].value
  const last = keyframes[keyframes.length - 1]
  if (time >= last.time) return last.value

  const i = findSegmentIndex(keyframes, time)
  const a = keyframes[i]
  const b = keyframes[i + 1]
  const span = b.time - a.time
  const u = span <= KEYFRAME_TIME_EPSILON ? 0 : (time - a.time) / span
  const f = easeProgress(a.easing, u)
  return interpolateValue(a.value, b.value, f, type)
}

/** 关键帧数组内查找与目标时间同点（容差内）的下标，无则 -1 */
export function indexOfKeyframeAtTime(keyframes: StageKeyframe[], time: number): number {
  return keyframes.findIndex((kf) => Math.abs(kf.time - time) <= KEYFRAME_TIME_EPSILON)
}

/** 插入或替换关键帧并保持按 time 升序（同点替换 value，可选保留原 easing） */
export function upsertKeyframe(
  keyframes: StageKeyframe[],
  next: StageKeyframe,
): StageKeyframe[] {
  const existing = indexOfKeyframeAtTime(keyframes, next.time)
  const result = keyframes.slice()
  if (existing >= 0) {
    result[existing] = { ...result[existing], value: next.value, easing: next.easing }
  } else {
    result.push(next)
    result.sort((a, b) => a.time - b.time)
  }
  return result
}
