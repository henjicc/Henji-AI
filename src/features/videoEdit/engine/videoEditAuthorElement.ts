import type { SpatialMat4 } from '@/core/videoEdit/spatialTypes'
import { contours } from 'd3-contour'
import simplify from 'simplify-js'

/** 作者根空间里的一个点（three 的 Vector3 可以直接 copy）。 */
export interface AuthorElementPoint { x: number; y: number; z: number }

/**
 * 三维作者通过图片参数引用的时间线片段：它此刻在三维里的位置与形状（`info.elements[参数键]`）。
 * 画面本身照旧在 `assets[参数键]`；这里给的是派生内容要用的几何，作者不必自己读像素、算投影。
 * 坐标都在作者根空间（作者片段自身的根变换已扣除），作者片段移动时派生内容不会被变换两次。
 */
export interface AuthorElement {
  readonly clipId: string
  /** 被引用片段画面（整幅序列大小）的 uv（左上为 0、向右向下）→ 作者根空间，列主序 4×4。 */
  readonly matrix: readonly number[]
  /** 画面上一点（uv）在作者根空间里的位置。 */
  at(u: number, v: number): AuthorElementPoint
  /** 外沿采样点：逐列（上下沿）或逐行（左右沿）取最外侧的不透明像素；`spacing` 为相邻两点在画面上的间隔（显示高度的比例，缺省约 0.004）。 */
  edge(side: 'bottom' | 'top' | 'left' | 'right', spacing?: number): AuthorElementPoint[]
  /** 在不透明区域里按覆盖均匀撒 `count` 个点（同一 `seed` 结果相同）。 */
  sample(count: number, seed?: number): AuthorElementPoint[]
  /**
   * 不透明区域的轮廓（作者接口 17 起）：每块一个外轮廓与若干个洞，点为画面 uv（左上为 0、向右向下）。
   * 用 uv 建 `THREE.Shape`（或挤出体）后整体乘 `matrix` 就放到片段的真实位置；挤出方向（z）在 `matrix` 里是一个显示高度一个单位。
   * `tolerance`：简化容差（画面高度的比例，缺省 0.0015），越大点越少。
   */
  outline?(tolerance?: number): AuthorElementPolygon[]
}
export interface AuthorElementPolygon { outer: Array<[number, number]>; holes: Array<Array<[number, number]>> }

interface Coverage { width: number; height: number; alpha: Uint8ClampedArray }
/**
 * 取形状只用缩小后的透明度：长边固定 512、短边按显示宽高比，与渲染分辨率无关（预览降分辨率与导出取到同一套点）；
 * 外沿、撒点的精度够用，扫描很便宜。
 */
const COVERAGE_SIDE = 512

function coverageOf(picture: CanvasImageSource & { width: number; height: number }, displayAspect: number): Coverage {
  const width = displayAspect >= 1 ? COVERAGE_SIDE : Math.max(1, Math.round(COVERAGE_SIDE * displayAspect))
  const height = displayAspect >= 1 ? Math.max(1, Math.round(COVERAGE_SIDE / displayAspect)) : COVERAGE_SIDE
  const context = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true })!
  context.drawImage(picture, 0, 0, width, height)
  const data = context.getImageData(0, 0, width, height).data
  const alpha = new Uint8ClampedArray(width * height)
  for (let index = 0; index < alpha.length; index++) alpha[index] = data[index * 4 + 3]
  return { width, height, alpha }
}

const OPAQUE = 128

/** `picture()` 在第一次真用到形状时才取（读回画面有代价，只用位置的作者不付这个代价）。 */
export function createAuthorElement(clipId: string, matrix: SpatialMat4, picture: () => CanvasImageSource & { width: number; height: number }, displayAspect: number, withOutline = false): AuthorElement {
  const m = matrix
  // 同一帧里第一次用到形状时才读回画面，之后复用（不再去取画面）。
  let coverage: Coverage | undefined
  const shape = (): Coverage => coverage ??= coverageOf(picture(), displayAspect)
  const at = (u: number, v: number): AuthorElementPoint => {
    const w = m[3] * u + m[7] * v + m[15] || 1
    return { x: (m[0] * u + m[4] * v + m[12]) / w, y: (m[1] * u + m[5] * v + m[13]) / w, z: (m[2] * u + m[6] * v + m[14]) / w }
  }
  const element: AuthorElement = {
    clipId, matrix: Object.freeze([...matrix]), at,
    edge(side: 'bottom' | 'top' | 'left' | 'right', spacing = .004): AuthorElementPoint[] {
      const { width, height, alpha } = shape()
      const vertical = side === 'bottom' || side === 'top'
      // 间隔按显示高度换成采样格：横向一格 = 1/width 的画面宽，画面宽 = 显示高度 × 宽高比。
      const step = Math.max(1, Math.round(vertical ? spacing / displayAspect * width : spacing * height))
      const points: AuthorElementPoint[] = []
      if (vertical) for (let x = 0; x < width; x += step) {
        for (let k = 0; k < height; k++) {
          const y = side === 'bottom' ? height - 1 - k : k
          if (alpha[y * width + x] < OPAQUE) continue
          points.push(at((x + .5) / width, side === 'bottom' ? (y + 1) / height : y / height)); break
        }
      } else for (let y = 0; y < height; y += step) {
        for (let k = 0; k < width; k++) {
          const x = side === 'right' ? width - 1 - k : k
          if (alpha[y * width + x] < OPAQUE) continue
          points.push(at(side === 'right' ? (x + 1) / width : x / width, (y + .5) / height)); break
        }
      }
      return points
    },
    outline(tolerance = .0015): AuthorElementPolygon[] {
      const { width, height, alpha } = shape()
      // 半透明阈值 128 与 edge、sample 相同；按像素网格的等值线（d3-contour，行进方块），再按显示高度的比例简化（simplify-js）。
      const values = Float64Array.from(alpha)
      const [field] = contours().size([width, height]).thresholds([OPAQUE])(values as unknown as number[])
      if (!field) return []
      const toUv = (ring: Array<[number, number]>): Array<[number, number]> => simplify(ring.map(([x, y]) => ({ x, y })), Math.max(0, tolerance) * height, true)
        .map(point => [point.x / width, point.y / height] as [number, number])
      return field.coordinates.map(polygon => ({ outer: toUv(polygon[0] as Array<[number, number]>), holes: polygon.slice(1).map(ring => toUv(ring as Array<[number, number]>)) }))
        .filter(polygon => polygon.outer.length >= 3)
    },
    sample(count: number, seed = 1): AuthorElementPoint[] {
      const { width, height, alpha } = shape()
      const covered: number[] = []
      for (let index = 0; index < alpha.length; index++) if (alpha[index] >= OPAQUE) covered.push(index)
      if (!covered.length || count <= 0) return []
      let state = seed >>> 0 || 1
      const next = (): number => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296 }
      return Array.from({ length: Math.floor(count) }, () => {
        const index = covered[Math.floor(next() * covered.length)]
        return at((index % width + next()) / width, (Math.floor(index / width) + next()) / height)
      })
    },
  }
  // 轮廓从作者接口 17 起提供，更早的接口版本保持原样。
  if (!withOutline) delete element.outline
  return Object.freeze(element)
}
