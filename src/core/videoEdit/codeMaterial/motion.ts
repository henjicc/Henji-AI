import { CodeMaterialError, finiteCodeNumber } from './contract'

export { PARAM_EASE_NAMES as CODE_EASE_NAMES } from '../../imaging/easing'
import { PARAM_EASE_NAMES as CODE_EASE_NAMES } from '../../imaging/easing'
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
