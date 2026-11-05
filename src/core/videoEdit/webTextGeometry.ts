import { CODE_AUTHOR_WEB_TEXT_MIN_API_VERSION } from './codeAuthorVersions'
/** 网页文本声明的起始作者接口；执行门槛与持久格式上界共用此处。 */
export const WEB_TEXT_AUTHOR_API_VERSION = CODE_AUTHOR_WEB_TEXT_MIN_API_VERSION
export const WEB_TEXT_SAMPLER_VERSION = 2
export type WebTextDeclaration = Readonly<Record<string, readonly string[]>>
export type WebTextRect = readonly [number, number, number, number]
export interface WebTextSource { readonly start: number; readonly end: number }
export interface WebTextFont {
  readonly fontFamily: string; readonly fontSize: string; readonly fontWeight: string; readonly fontStyle: string
  readonly fontStretch: string; readonly lineHeight: string; readonly letterSpacing: string; readonly wordSpacing: string
  readonly direction: string; readonly writingMode: string; readonly fontFeatureSettings: string
  readonly fontVariationSettings: string; readonly whiteSpace: string; readonly textTransform: string; readonly lang: string
}
export interface WebTextFragment { readonly rect: WebTextRect; readonly line: number | null }
export type WebTextBreakKind = 'line-break' | 'block' | 'language' | 'replaced-element'
export interface WebTextBreak { readonly offset: number; readonly kind: WebTextBreakKind }
export type WebTextLayoutStatus = 'box' | 'zero-width' | 'collapsed-whitespace' | 'display-none' | 'visibility-hidden' | 'content-hidden'
export interface WebTextGrapheme {
  readonly source: WebTextSource
  /** 目标内 Text 节点序号与节点内 UTF-16 区间；跨内联节点的字素保留全部来源。 */
  readonly segments: readonly { readonly node: number; readonly start: number; readonly end: number; readonly font: number }[]
  readonly rects: readonly WebTextFragment[]
  readonly bounds: WebTextRect | null
  readonly pivot: readonly [number, number] | null
  readonly baseline: null
  /** Range 布局状态独立于透明度与取景；零宽片段保留位置。 */
  readonly layoutStatus: WebTextLayoutStatus
  readonly transparent: boolean
  readonly outsideRegion: boolean
  readonly regionRects: readonly WebTextFragment[]
  readonly rendered: boolean
  readonly overlaps: boolean
}
export interface WebTextWord { readonly source: WebTextSource; readonly isWordLike: boolean; readonly graphemes: readonly number[]; readonly rects: readonly WebTextFragment[] }
export interface WebTextLineFragment { readonly rect: WebTextRect; readonly node: number; readonly font: number }
export interface WebTextGeometry {
  readonly coordinateSpace: 'viewport-css'
  readonly coverage: 'dom-text-only'
  readonly text: string
  readonly breaks: readonly WebTextBreak[]
  readonly fonts: readonly WebTextFont[]
  readonly graphemes: readonly WebTextGrapheme[]
  readonly words: readonly WebTextWord[]
  readonly lineFragments: readonly WebTextLineFragment[]
  /** 与 graphemes 一一对应的格子（画面像素整数 [x,y,w,h]），互不重叠地铺满文字；竖排或没有位置的字素为 null。 */
  readonly cells?: readonly (WebTextRect | null)[]
  readonly segmentation: readonly { readonly source: WebTextSource; readonly locale: string; readonly contract: 'intl-segmenter' }[]
  readonly limitations: readonly string[]
}
export type WebTextResult = { readonly status: 'ready'; readonly geometry: WebTextGeometry }
  | { readonly status: 'not-found' }
  | { readonly status: 'unsupported' | 'unavailable'; readonly reason: string; readonly details?: readonly string[] }
export type WebTextResults = Readonly<Record<string, WebTextResult>>
export interface WebTextCapture {
  readonly samplerVersion: number
  readonly ticket: string
  readonly time: number
  readonly contentHash: string
  readonly results: WebTextResults
  readonly sampleMs: number
  readonly serializationMs: number
  readonly bytes: number
}
export interface WebTextImageMapping {
  readonly contentWidth: number
  readonly contentHeight: number
  /** CSS viewport → 有效图像像素，按 Canvas 仿射矩阵 [a,b,c,d,e,f]。 */
  readonly viewportToImage: readonly [number, number, number, number, number, number]
}
export function webTextImageMapping(region: WebTextRect, width: number, height: number): WebTextImageMapping {
  const sx = width / region[2], sy = height / region[3]
  return { contentWidth: width, contentHeight: height, viewportToImage: [sx, 0, 0, sy, -region[0] * sx, -region[1] * sy] }
}
export function webTextSelectors(input: unknown, field = 'text'): string[] {
  if (!Array.isArray(input) || input.some(value => typeof value !== 'string' || !value.trim())) throw new Error(`${field} 需要非空 CSS 选择器字符串数组`)
  return [...new Set(input as string[])].sort()
}
export function unavailableWebText(selectors: readonly string[], reason: string): WebTextResults {
  return Object.fromEntries(selectors.map(selector => [selector, { status: 'unavailable' as const, reason }]))
}
type CellBox = { selector: string; index: number; x0: number; y0: number; x1: number; y1: number }
type CellCut = { axis: 'x' | 'y'; at: number; deepest: number; total: number; gap: number }
/** 每个方向最多试这么多条候选切线：字多的页面每帧都要算，切线落点只需要落在某个字的边上。 */
const CELL_CUT_CANDIDATES = 64

/** 这一轴上切入字素最浅的一条切线。切入深度按字素自身尺寸归一，只看最深的那个字：宁可每个字擦一点边，也不把一个字切穿。 */
function shallowestCut(boxes: readonly CellBox[], axis: 'x' | 'y'): CellCut | undefined {
  const low = axis === 'x' ? 'x0' : 'y0', high = axis === 'x' ? 'x1' : 'y1'
  const edges = [...new Set(boxes.flatMap(box => [box[low], box[high]]))].sort((a, b) => a - b)
  const step = Math.max(1, Math.floor(edges.length / CELL_CUT_CANDIDATES))
  let best: CellCut | undefined
  for (let index = 0; index < edges.length; index += step) {
    // 候选就是字的边：紧贴的字边界就是字距。
    const at = edges[index]
    let before = 0, deepest = 0, total = 0, reach = -Infinity, start = Infinity
    for (const box of boxes) {
      if ((box[low] + box[high]) / 2 < at) { before++; reach = Math.max(reach, box[high]) } else start = Math.min(start, box[low])
      if (box[low] < at && box[high] > at) {
        const depth = Math.min(at - box[low], box[high] - at) / (box[high] - box[low])
        deepest = Math.max(deepest, depth); total += depth
      }
    }
    if (!before || before === boxes.length) continue
    // 两侧之间有空隙时切在空隙中点，发光和外扩阴影两边各分一半。
    const gap = start - reach
    const candidate = { axis, at: Math.round(gap > 0 ? (reach + start) / 2 : at), deepest, total, gap }
    if (!best || candidate.deepest < best.deepest - 1e-6 || Math.abs(candidate.deepest - best.deepest) <= 1e-6 && (candidate.total < best.total - 1e-6 || Math.abs(candidate.total - best.total) <= 1e-6 && candidate.gap > best.gap)) best = candidate
  }
  return best
}

/**
 * 递归切分画面（XY-cut）：每次选切入字素最浅的一条切线，切线由两侧共用，所以结果在几何上不可能重叠，也不依赖行的概念，
 * 多栏、错行、大小字混排、行距比字盒还小都成立。排版盒常比字形窄（发光、斜体、外扩阴影都在盒外），按格子切才不丢墨迹也不重复。
 */
function cutWebTextCells(boxes: CellBox[], area: [number, number, number, number], place: (box: CellBox, area: [number, number, number, number]) => void): void {
  if (boxes.length === 1) { place(boxes[0], area); return }
  const [vertical, horizontal] = [shallowestCut(boxes, 'x'), shallowestCut(boxes, 'y')]
  const better = (a: CellCut, b: CellCut): CellCut => a.deepest < b.deepest - 1e-6 ? a : b.deepest < a.deepest - 1e-6 ? b : a.gap >= b.gap ? a : b
  const cut = vertical && horizontal ? better(vertical, horizontal) : vertical ?? horizontal
  const [x0, y0, x1, y1] = area
  if (!cut) {
    // 完全重合的字素：格子只能归第一个，其余不再占位。
    place(boxes[0], area)
    return
  }
  const middle = (box: CellBox): number => cut.axis === 'x' ? (box.x0 + box.x1) / 2 : (box.y0 + box.y1) / 2
  const raw = boxes.filter(box => middle(box) < cut.at), rest = boxes.filter(box => middle(box) >= cut.at)
  // 切线取整后中心可能落到另一侧；这时按未取整的归属不再可得，退回对半。
  const half = Math.ceil(boxes.length / 2), sorted = [...boxes].sort((a, b) => middle(a) - middle(b))
  const before = raw.length && rest.length ? raw : sorted.slice(0, half), after = raw.length && rest.length ? rest : sorted.slice(half)
  const clamped = cut.axis === 'x' ? Math.max(x0, Math.min(x1, cut.at)) : Math.max(y0, Math.min(y1, cut.at))
  cutWebTextCells(before, cut.axis === 'x' ? [x0, y0, clamped, y1] : [x0, y0, x1, clamped], place)
  cutWebTextCells(after, cut.axis === 'x' ? [clamped, y0, x1, y1] : [x0, clamped, x1, y1], place)
}

/**
 * 给每个就绪的结果补上字素格子。同一幅文字层里的所有选择器一起切：分开切时一个选择器的格子会切到另一个选择器的字。
 * 选择器嵌套时同一个字只归第一个选择器，否则会被画两遍。
 */
export function withWebTextCells(results: WebTextResults, mapping: WebTextImageMapping): WebTextResults {
  const [sx, , , sy, ox, oy] = mapping.viewportToImage
  const boxes: CellBox[] = [], cells = new Map<string, (WebTextRect | null)[]>(), seen = new Set<string>()
  for (const [selector, result] of Object.entries(results)) {
    if (result.status !== 'ready') continue
    const { geometry } = result
    cells.set(selector, geometry.graphemes.map(() => null))
    geometry.graphemes.forEach((grapheme, index) => {
      const bounds = grapheme.bounds
      if (!bounds || bounds[2] <= 0 || bounds[3] <= 0) return
      const key = bounds.join()
      if (seen.has(key)) return
      seen.add(key)
      boxes.push({ selector, index, x0: bounds[0] * sx + ox, y0: bounds[1] * sy + oy, x1: (bounds[0] + bounds[2]) * sx + ox, y1: (bounds[1] + bounds[3]) * sy + oy })
    })
  }
  if (boxes.length) cutWebTextCells(boxes, [0, 0, mapping.contentWidth, mapping.contentHeight], (box, [x0, y0, x1, y1]) => {
    // 切分铺满整幅画面；每格只留字素周围一个字高的范围，够装发光和外扩阴影，也不必为大片空白搬动纹理。
    const pad = Math.ceil(Math.max(box.x1 - box.x0, box.y1 - box.y0))
    const left = Math.max(x0, Math.floor(box.x0 - pad)), top = Math.max(y0, Math.floor(box.y0 - pad))
    const right = Math.min(x1, Math.ceil(box.x1 + pad)), bottom = Math.min(y1, Math.ceil(box.y1 + pad))
    cells.get(box.selector)![box.index] = right > left && bottom > top ? [left, top, right - left, bottom - top] : null
  })
  return Object.fromEntries(Object.entries(results).map(([selector, result]) => [selector, result.status === 'ready' ? { ...result, geometry: { ...result.geometry, cells: cells.get(selector) } } : result]))
}

/** 作者入口共享只读值；没有 DOM/GPU 对象，跨 IPC 后仍需重新冻结。 */
export function freezeWebText<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeWebText(child)
    Object.freeze(value)
  }
  return value
}

/** 正式错误通道只解释用户可采取的恢复动作，原因码留在几何与诊断日志。 */
export function webTextUnavailableMessage(reason: string): string {
  if (reason === 'capture-path') return '此网页当前的画面捕获方式无法提供精确文字位置。请使用带有文本舞台的网页，或移除文字位置声明。'
  if (reason === 'unsynchronized') return '网页文字与画面尚未同步。请等待字体加载完成，并让网页在定位后停止动画和布局变化，再重试。'
  return '当前网页画面缺少所需的文字位置。请重新取帧后重试。'
}
