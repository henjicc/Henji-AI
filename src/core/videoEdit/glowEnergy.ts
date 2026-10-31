import type { ImagingParams } from '../imaging/parameterDefinition'
import type { EffectQuality } from '../imaging/effects/descriptor'

type V3 = [number, number, number]
const LEVEL_RADIUS = 1.5
const REFERENCE_RADIUS = 3 / 1080
export const GLOW_GAIN = 3.2

interface Profile { values: Float64Array; start: number; scale: number }
const supportCache = new Map<string, number>()

/** 外扩只依赖参数与几何；缓存标量结果，动画经过的档位按最近使用顺序逐出。 */
export function glowEnergySupport(params: ImagingParams, width: number, height: number, referenceHeight: number, quality: EffectQuality = 'interactive'): number {
  const key = JSON.stringify([Object.keys(params).sort().map(name => [name, params[name]]), width, height, referenceHeight, quality])
  const cached = supportCache.get(key)
  if (cached !== undefined) { supportCache.delete(key); supportCache.set(key, cached); return cached }
  const support = calculateGlowEnergySupport(params, width, height, referenceHeight)
  supportCache.set(key, support)
  if (supportCache.size > 128) supportCache.delete(supportCache.keys().next().value!)
  return support
}
const BOX_OFFSETS = [-2, -1, 0, 1, 2]
const BOX_WEIGHTS = [.125, .25, .25, .25, .125]
function sample(profile: Profile, position: number): number {
  const at = position * profile.scale - .5 - profile.start, low = Math.floor(at), mix = at - low
  return (profile.values[low] ?? 0) * (1 - mix) + (profile.values[low + 1] ?? 0) * mix
}
function filter(source: Profile, scale: number, extent: number, support: number, offsets: readonly number[], weights: readonly number[]): Profile {
  const start = Math.floor(-support * scale), end = Math.ceil((extent + support) * scale)
  const values = new Float64Array(end - start)
  for (let i = 0; i < values.length; i++) {
    const position = (start + i + .5) / scale
    for (let tap = 0; tap < offsets.length; tap++) values[i] += sample(source, position + offsets[tap]) * weights[tap]
  }
  return { values, start, scale }
}
function blur(source: Profile, sigma: number, projection: number, extent: number, support: number): Profile {
  const radius = Math.min(48, Math.ceil(sigma * 3)), taps = Array.from({ length: radius * 2 + 1 }, (_, i) => i - radius)
  const weights = taps.map(x => Math.exp(-.5 * (x / sigma) ** 2)), total = weights.reduce((a, b) => a + b, 0)
  return filter(source, source.scale, extent, support, taps.map(x => x * projection / source.scale), weights.map(w => w / total))
}
/** 用正式正权卷积核的一维投影求有限白色条带的最坏光强；实际有限矩形不可能比任一条带更亮。
 * 全部采样使用内容原点与双线性网格，包含降采样、旋转高斯和逐级 tent，而非以理论支撑当作可见边距。
 */
function calculateGlowEnergySupport(params: ImagingParams, width: number, height: number, referenceHeight: number): number {
  const resolution = Number(params.resolution) / 100
  const reach = Math.log2(referenceHeight * .004 * 150 ** (Number(params.radius) / 100) * resolution / 1.5) + 1
  const count = Math.max(1, Math.ceil(reach - 1e-9))
  const weights = glowLevelWeights(count, reach, resolution, referenceHeight, .45 + .55 * Number(params.falloff) / 100, 0, [1, 1, 1], [1, 1, 1])
  const gain = (Number(params.strength) / 100) ** 2 * GLOW_GAIN
  const ditherGain = 1 + 4 * Number(params.dither) / 100
  const aspectValue = Number(params.aspect), aspect = 8 ** (Math.abs(aspectValue) / 100)
  const angle = (Number(params.angle) + (aspectValue < 0 ? 90 : 0)) * Math.PI / 180
  const support = Math.ceil((2 ** count - 1) * (4 + 3 * aspect + 3) / resolution + 2)
  let radius = 0
  for (const [along, across, extent] of [[Math.cos(angle), -Math.sin(angle), width], [Math.sin(angle), Math.cos(angle), height]]) {
    const source: Profile = { values: new Float64Array(extent).fill(1), start: 0, scale: 1 }
    let down = filter(source, resolution, extent, support, BOX_OFFSETS.map(x => x * .5 / resolution), BOX_WEIGHTS)
    const levels: Profile[] = []
    for (let level = 0; level < count; level++) {
      if (level) down = filter(down, down.scale / 2, extent, support, BOX_OFFSETS.map(x => x / down.scale), BOX_WEIGHTS)
      levels.push(blur(blur(down, aspect, along, extent, support), 1, across, extent, support))
    }
    let accumulated = levels[count - 1]
    accumulated.values = accumulated.values.map(value => value * weights[count - 1][0])
    for (let level = count - 2; level >= 0; level--) {
      const up = filter(accumulated, levels[level].scale, extent, support, [-1 / accumulated.scale, 0, 1 / accumulated.scale], [.25, .5, .25])
      const own = levels[level]
      up.values = up.values.map((value, i) => value + own.values[i] * weights[level][0])
      accumulated = up
    }
    // 黑底附近 sRGB 最大斜率为 12.92；抖动随暗部亮度放大，另留 1% 给半精度舍入。
    for (let distance = 0; distance <= support; distance++) {
      const energy = Math.max(sample(accumulated, -.5 - distance), sample(accumulated, extent + .5 + distance))
      if (energy * gain * 12.92 * ditherGain * 1.01 >= 1 / 510) radius = Math.max(radius, distance + 1)
    }
  }
  return radius
}

export function glowLevelWeights(count: number, reach: number, resolution: number, height: number, falloff: number, tint: number, inner: V3, outer: V3): V3[] {
  const energy = (octave: number): number => octave >= 0 ? falloff ** octave : 2 ** octave
  const covered = (index: number): number => Math.min(1, Math.max(0, reach - index))
  const first = Math.log2(LEVEL_RADIUS / resolution / (REFERENCE_RADIUS * height))
  let finer = 0
  for (let step = 1; step <= 24; step++) finer += energy(first - step) * covered(-step)
  return Array.from({ length: count }, (_, index) => {
    const weight = energy(first + index) * covered(index) + (index === 0 ? finer : 0)
    const position = count > 1 ? index / (count - 1) : 0
    return [0, 1, 2].map(channel => weight * (1 + (inner[channel] + (outer[channel] - inner[channel]) * position - 1) * tint)) as V3
  })
}
