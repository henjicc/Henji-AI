import { CodeMaterialError, finiteCodeNumber } from './contract'

export { PARAM_EASE_NAMES as CODE_EASE_NAMES } from '../../imaging/easing'
import { PARAM_EASE_NAMES as CODE_EASE_NAMES } from '../../imaging/easing'
export const codeProgress = (time: number, start: number, duration: number): number => {
  if (duration <= 0) throw new CodeMaterialError('TYPE', '动效 duration 必须大于零。')
  return Math.min(1, Math.max(0, (time - start) / duration))
}
export function codeEase(name: string, input: number, overshoot = 1.70158): number {
  const t = Math.min(1, Math.max(0, input))
  if (!CODE_EASE_NAMES.includes(name)) throw new CodeMaterialError('TYPE', `未知缓动：${name}`)
  if (name === 'linear') return t
  if (t === 0 || t === 1) return t
  if (name === 'backOut') { const x = t - 1; return 1 + (overshoot + 1) * x ** 3 + overshoot * x ** 2 }
  if (name === 'elasticOut') return 2 ** (-10 * t) * Math.sin((t * 10 - .75) * (2 * Math.PI / 3)) + 1
  if (name === 'bounceOut') {
    const n = 7.5625; const d = 2.75
    if (t < 1 / d) return n * t * t
    if (t < 2 / d) return n * (t - 1.5 / d) ** 2 + .75
    if (t < 2.5 / d) return n * (t - 2.25 / d) ** 2 + .9375
    return n * (t - 2.625 / d) ** 2 + .984375
  }
  const suffix = name.endsWith('InOut') ? 'InOut' : name.endsWith('Out') ? 'Out' : 'In'
  const family = name.slice(0, -suffix.length)
  const inward = (x: number): number => {
    switch (family) {
      case 'sine': return 1 - Math.cos(x * Math.PI / 2)
      case 'quad': return x ** 2; case 'cubic': return x ** 3; case 'quart': return x ** 4; case 'quint': return x ** 5
      case 'expo': return x === 0 ? 0 : 2 ** (10 * x - 10)
      case 'circ': return 1 - Math.sqrt(Math.max(0, 1 - x * x))
      default: throw new CodeMaterialError('TYPE', '未知缓动族。')
    }
  }
  return suffix === 'In' ? inward(t) : suffix === 'Out' ? 1 - inward(1 - t) : t < .5 ? inward(2 * t) / 2 : 1 - inward(2 - 2 * t) / 2
}
/** Fixed 24-step bisection makes inversion independent of convergence/host clock. */
export function codeCubicBezier(x1: number, y1: number, x2: number, y2: number, input: number): number {
  if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) throw new CodeMaterialError('TYPE', 'cubicBezier 的 x 控制点须在 0–1。')
  const t = Math.min(1, Math.max(0, input)); if (t === 0 || t === 1) return t
  const curve = (u: number, a: number, b: number): number => 3 * (1 - u) ** 2 * u * a + 3 * (1 - u) * u * u * b + u ** 3
  let lo = 0; let hi = 1
  for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (curve(mid, x1, x2) < t) lo = mid; else hi = mid }
  return finiteCodeNumber(curve((lo + hi) / 2, y1, y2), '贝塞尔缓动')
}
/** Seeded trilinear value noise. All hash inputs are fixed-width integers. */
export function codeNoise(x: number, y = 0, z = 0, seed = 0): number {
  const base = [Math.floor(x), Math.floor(y), Math.floor(z)]
  const fractions = [x - base[0], y - base[1], z - base[2]].map(t => t * t * (3 - 2 * t))
  let result = 0
  for (let corner = 0; corner < 8; corner++) {
    const dx = corner & 1; const dy = corner >> 1 & 1; const dz = corner >> 2 & 1
    let hash = seed ^ Math.imul(base[0] + dx, 73856093) ^ Math.imul(base[1] + dy, 19349663) ^ Math.imul(base[2] + dz, 83492791)
    hash = Math.imul(hash ^ hash >>> 16, 0x7feb352d); hash = Math.imul(hash ^ hash >>> 15, 0x846ca68b)
    const weight = (dx ? fractions[0] : 1 - fractions[0]) * (dy ? fractions[1] : 1 - fractions[1]) * (dz ? fractions[2] : 1 - fractions[2])
    result += ((hash ^ hash >>> 16) >>> 0) / 4294967296 * weight
  }
  return result
}
