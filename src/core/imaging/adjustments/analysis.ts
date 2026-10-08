import type { ImagingParams } from '../parameterDefinition'
import { colorGradeDefaults } from './schema'
import { encodeColorGradeCurve } from './curves'
interface ChannelStats { mean: number; deviation: number; quantiles: number[] }
function stats(pixels: ArrayLike<number>, scale: number): ChannelStats[] {
  if (!pixels.length || pixels.length % 4 || !Number.isFinite(scale) || scale <= 0) throw new Error('匹配颜色需要有效的 RGBA 画面。')
  const histograms = Array.from({ length: 3 }, () => new Uint32Array(1024)); const sum = [0, 0, 0]; const squares = [0, 0, 0]; let count = 0
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] / scale < .5) continue
    for (let c = 0; c < 3; c++) { const value = Math.max(0, Math.min(1, pixels[i + c] / scale)); sum[c] += value; squares[c] += value * value; histograms[c][Math.round(value * 1023)]++ }
    count++
  }
  if (count < 8) throw new Error('匹配需要更多可见画面，请选择其他参考片段。')
  return sum.map((total, c) => {
    const mean = total / count
    const quantiles = Array.from({ length: 11 }, (_, k) => { let n = 0; for (let i = 0; i < 1024; i++) { n += histograms[c][i]; if (n >= Math.max(1, count * (.02 + .096 * k))) return i / 1023 } return 1 })
    return { mean, deviation: Math.sqrt(Math.max(0, squares[c] / count - mean * mean)), quantiles }
  })
}
/** Reinhard-style per-channel moments, or robust quantile correspondence; suggestions stay in the shared curve pipeline. */
export function suggestColorGradeMatch(source: ArrayLike<number>, reference: ArrayLike<number>, method: 'moments' | 'histogram' = 'moments', scale = 255): ImagingParams {
  const from = stats(source, scale); const to = stats(reference, scale)
  // Samples precede this ColorGrade. Reset its previous look so applying a match does not grade twice.
  const parameters = colorGradeDefaults()
  ;['red', 'green', 'blue'].forEach((channel, c) => {
    const gain = from[c].deviation > .005 ? Math.min(4, to[c].deviation / from[c].deviation) : 1
    const map = (x: number): number => Math.max(0, Math.min(100, ((x - from[c].mean) * gain + to[c].mean) * 100))
    const points = method === 'moments' ? Array.from({ length: 32 }, (_, i) => ({ x: i / 31 * 100, y: map(i / 31) })) : [{ x: 0, y: map(0) }, ...from[c].quantiles.map((x, i) => ({ x: x * 100, y: to[c].quantiles[i] * 100 })).filter((point, i, all) => point.x > 0 && point.x < 100 && (!i || point.x > all[i - 1].x)), { x: 100, y: map(1) }]
    // Histogram end tails must remain ordered too; retain the first/last sampled target values.
    if (method === 'histogram' && points.length > 2) { points[0].y = Math.min(points[0].y, points[1].y); points[points.length - 1].y = Math.max(points[points.length - 1].y, points[points.length - 2].y) }
    parameters[`curve_${channel}_points`] = encodeColorGradeCurve(points)
  })
  return parameters
}
