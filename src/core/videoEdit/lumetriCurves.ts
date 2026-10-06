export interface LumetriCurvePoint { x: number; y: number }
export const LUMETRI_MAX_CURVE_POINTS = 32
/** Coordinates are percentages. Empty encoding means legacy five anchors / neutral hue curve. */
export function parseLumetriCurve(value: unknown): LumetriCurvePoint[] {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('曲线需要最多32个 {x,y} 百分比控制点的 JSON 数组。')
  if (!value) return []
  const points: unknown = JSON.parse(value)
  if (!Array.isArray(points) || points.length < 2 || points.length > LUMETRI_MAX_CURVE_POINTS) throw new Error('曲线需要2–32个控制点。')
  return points.map((point: unknown, i: number) => {
    if (!point || typeof point !== 'object' || Object.keys(point).some(key => key !== 'x' && key !== 'y')) throw new Error('曲线控制点只能包含 x 和 y。')
    const { x, y } = point as Record<string, unknown>
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 100 || y < 0 || y > 100 || (i > 0 && x <= (points[i - 1] as LumetriCurvePoint).x)) throw new Error('曲线 x/y 必须在0–100，x 严格递增。')
    return { x, y }
  })
}
export function encodeLumetriCurve(points: readonly LumetriCurvePoint[]): string { const value = JSON.stringify(points); parseLumetriCurve(value); return value }
/** Fritsch–Carlson: limit Hermite tangents to keep every segment within its endpoints. */
export function lumetriSpline(points: readonly LumetriCurvePoint[]): (x: number) => number {
  const slopes = points.slice(1).map((p, i) => (p.y - points[i].y) / (p.x - points[i].x))
  const tangents = points.map((_, i) => i === 0 ? slopes[0] : i === points.length - 1 ? slopes[i - 1] : slopes[i - 1] * slopes[i] <= 0 ? 0 : (slopes[i - 1] + slopes[i]) / 2)
  slopes.forEach((slope, i) => {
    if (slope === 0) { tangents[i] = 0; tangents[i + 1] = 0; return }
    const a = tangents[i] / slope; const b = tangents[i + 1] / slope; const norm = Math.hypot(a, b)
    if (norm > 3) { tangents[i] = 3 * a / norm * slope; tangents[i + 1] = 3 * b / norm * slope }
  })
  return x => {
    if (x <= points[0].x) return points[0].y
    if (x >= points[points.length - 1].x) return points[points.length - 1].y
    const i = points.findIndex((point, index) => index < points.length - 1 && x < points[index + 1].x)
    const left = points[i]; const right = points[i + 1]; const h = right.x - left.x; const t = (x - left.x) / h
    return (2 * t ** 3 - 3 * t ** 2 + 1) * left.y + (t ** 3 - 2 * t ** 2 + t) * h * tangents[i] + (-2 * t ** 3 + 3 * t ** 2) * right.y + (t ** 3 - t ** 2) * h * tangents[i + 1]
  }
}
export function lumetriCurvePoints(params: Readonly<Record<string, unknown>>, channel: string): LumetriCurvePoint[] {
  const points = parseLumetriCurve(params[`curve_${channel}_points`] ?? '')
  return points.length ? points : Array.from({ length: 5 }, (_, i) => ({ x: i * 25, y: Number(params[`curve_${channel}_${i}`] ?? i * 25) }))
}
export function lumetriCurveLut(points: readonly LumetriCurvePoint[], size = 1024): Float32Array {
  const evaluate = lumetriSpline(points)
  return Float32Array.from({ length: size }, (_, i) => evaluate(i / (size - 1) * 100) / 100)
}
