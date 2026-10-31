import { RETIRED_BLUR_EFFECTS } from './blur'
import { WHITE_HEX } from '../theme/colorTokens'
import type { VideoEditBezier, VideoEditInterpolation } from './keyframeInterpolation'
import { evaluateVideoEditKeyframes, type VideoEditKeyframe } from './keyframes'

/*
 * 效果库第一批合并后的存档换算，剪辑内容 46 → 47、录制 49 → 50 的迁移与本机效果库、预设包、风格库、风格包读取共用。
 * - 高斯、方向、缩放、镜头模糊并成“模糊”（方式 + 模糊度），换算公式在 `blur.ts`。模糊度与旧的标准差、长度、强度
 *   不是线性关系：旧曲线在旧量上插值（含贝塞尔、修剪后的 easeRange/easeValues），只换算关键帧会让两帧之间和修剪接缝处跳变，
 *   所以这类曲线按旧曲线逐帧求值再换算，得到逐帧的线性关键帧，再合并与连线相差不到 0.1 模糊度的点；每一帧的画面与旧效果相同。
 * - 暗角的数量从 −100–100 改为 0–100 加颜色：旧的负数（四周提亮）换成同样大小的数量配白色，画面不变。
 * 其余并入别的效果的旧条目（亮度与对比度、曝光、色温与色调、色相与饱和度等）按 2026-10-31 的决定不换算，读取时原样保留。
 */
type Value = unknown
type Keyframe = { time: number; value: Value; interpolation: VideoEditInterpolation; easeValues?: [Value, Value]; easeRange?: [number, number]; bezier?: VideoEditBezier } & Record<string, unknown>
type Instance = { id: string; params: Record<string, Value>; curves?: Record<string, Keyframe[]> } & Record<string, unknown>

/** 换算后与连线相差不到这么多模糊度（约 0.2% 的标准差）的中间帧可以省掉，人眼分不出。 */
const RESAMPLE_TOLERANCE = 0.1

/**
 * 逐帧样本合成尽量少的线性关键帧：从上一个关键帧出发，维护“经过所有样本 ± 容差”的斜率区间，区间空了就在上一帧落一个点。
 * 每个样本只看一次。
 */
function linearize(samples: readonly Keyframe[]): Keyframe[] {
  const kept: Keyframe[] = []
  let anchor: Keyframe | undefined; let low = -Infinity; let high = Infinity; let last: Keyframe | undefined
  const start = (point: Keyframe): void => { kept.push(point); anchor = point; low = -Infinity; high = Infinity; last = undefined }
  for (const sample of samples) {
    if (!anchor || anchor.interpolation !== 'linear' || typeof anchor.value !== 'number' || typeof sample.value !== 'number') { start(sample); continue }
    const span = sample.time - anchor.time
    const nextLow = Math.max(low, (sample.value - RESAMPLE_TOLERANCE - anchor.value) / span), nextHigh = Math.min(high, (sample.value + RESAMPLE_TOLERANCE - anchor.value) / span)
    if (nextLow <= nextHigh && sample.interpolation === 'linear') { low = nextLow; high = nextHigh; last = sample; continue }
    if (last) {
      const point = { ...last, value: anchor.value + (low + high) / 2 * (last.time - anchor.time) }
      start(point)
      const again = sample.time - point.time
      if (sample.interpolation === 'linear') { low = (sample.value - RESAMPLE_TOLERANCE - (point.value as number)) / again; high = (sample.value + RESAMPLE_TOLERANCE - (point.value as number)) / again; last = sample; continue }
    }
    start(sample)
  }
  if (last && anchor) kept.push({ ...last, value: anchor.value as number + (low + high) / 2 * (last.time - anchor.time) })
  return kept
}

/** 非线性换算的曲线：有插值的段逐帧求旧值再换算，定格段与最后一点只换算数值。 */
function resample(points: readonly Keyframe[], convert: (value: Value) => Value): Keyframe[] {
  const plain = ({ easeRange: _range, easeValues: _values, bezier: _bezier, ...point }: Keyframe): Keyframe => point
  const samples: Keyframe[] = []
  points.forEach((left, index) => {
    const right = points[index + 1]
    if (!right || left.interpolation === 'hold' || typeof left.value !== 'number' || typeof right.value !== 'number') { samples.push({ ...plain(left), value: convert(left.value), ...(left.interpolation === 'hold' ? {} : { interpolation: 'linear' as const }) }); return }
    // 与播放时同一个求值函数，连第一点、修剪接缝处的取值规则也一样。
    for (let time = left.time; time < right.time; time++) samples.push({ ...(time === left.time ? plain(left) : {}), time, value: convert(evaluateVideoEditKeyframes(points as VideoEditKeyframe[], time, left.value as number)), interpolation: 'linear' })
  })
  return linearize(samples)
}

function migrateBlur(instance: Instance): Instance {
  const rule = RETIRED_BLUR_EFFECTS[instance.id]
  const params: Record<string, Value> = { mode: rule.mode }
  for (const [key, [target, convert]] of Object.entries(rule.keys)) params[target] = convert(key in instance.params ? instance.params[key] : rule.defaults[key])
  const curves: Record<string, Keyframe[]> = {}
  for (const [key, points] of Object.entries(instance.curves ?? {})) {
    const mapping = rule.keys[key]
    if (!mapping) continue
    const [target, convert, nonlinear] = mapping
    curves[target] = nonlinear ? resample(points, convert) : points.map(point => ({ ...point, value: convert(point.value), ...(point.easeValues ? { easeValues: point.easeValues.map(convert) as [Value, Value] } : {}) }))
  }
  const { curves: _curves, ...rest } = instance
  return { ...rest, id: 'blur', params, ...(Object.keys(curves).length ? { curves } : {}) }
}

/**
 * 旧暗角的负数量（四周提亮）换成正数量配白色。数量曲线全程不大于 0 时连关键帧一起换；
 * 曲线一会儿正一会儿负的没法用一种颜色表达，保留原值（负的那段使用时按 0 处理）。
 */
function migrateVignette(instance: Instance): Instance {
  const points = instance.curves?.amount ?? []
  const values = [instance.params.amount, ...points.flatMap(point => [point.value, ...(point.easeValues ?? [])])].filter((value): value is number => typeof value === 'number')
  if (!values.some(value => value < 0) || values.some(value => value > 0) || instance.params.color !== undefined) return instance
  const flip = (value: Value): Value => typeof value === 'number' ? Math.abs(value) : value
  return {
    ...instance, params: { ...instance.params, ...(typeof instance.params.amount === 'number' ? { amount: flip(instance.params.amount) } : {}), color: WHITE_HEX },
    ...(points.length ? { curves: { ...instance.curves, amount: points.map(point => ({ ...point, value: flip(point.value), ...(point.easeValues ? { easeValues: point.easeValues.map(flip) as [Value, Value] } : {}) })) } } : {}),
  }
}

function migrateInstance(instance: Instance): Instance {
  if (RETIRED_BLUR_EFFECTS[instance.id]) return migrateBlur(instance)
  if (instance.id === 'vignette') return migrateVignette(instance)
  return instance
}

/**
 * 任意存档内容里的内置效果实例都换（片段、模板、风格副本、预设里的效果链）：遇到 `builtin` 就按上面的规则换算。
 * 剪辑与录制的格式迁移调用它；本机效果库、预设包、风格库与风格包在读取时也调用，格式版本不变。
 */
export function migrateVideoEditMergedEffects<T>(content: T): T {
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk)
    if (!value || typeof value !== 'object') return value
    const entries = Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, key === 'builtin' && entry && typeof entry === 'object' && typeof (entry as Instance).id === 'string' && (entry as Instance).params && typeof (entry as Instance).params === 'object' ? migrateInstance(entry as Instance) : walk(entry)])
    return Object.fromEntries(entries)
  }
  return walk(content) as T
}
