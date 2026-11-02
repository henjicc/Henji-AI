import { CodeMaterialError, finiteCodeNumber } from './contract'

export { PARAM_EASE_NAMES as CODE_EASE_NAMES } from '../../imaging/easing'
/** Fixed 24-step bisection makes inversion independent of convergence/host clock. */
export function codeCubicBezier(x1: number, y1: number, x2: number, y2: number, input: number): number {
  if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) throw new CodeMaterialError('TYPE', 'cubicBezier 的 x 控制点须在 0–1。')
  const t = Math.min(1, Math.max(0, input)); if (t === 0 || t === 1) return t
  const curve = (u: number, a: number, b: number): number => 3 * (1 - u) ** 2 * u * a + 3 * (1 - u) * u * u * b + u ** 3
  let lo = 0; let hi = 1
  for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (curve(mid, x1, x2) < t) lo = mid; else hi = mid }
  return finiteCodeNumber(curve((lo + hi) / 2, y1, y2), '贝塞尔缓动')
}
