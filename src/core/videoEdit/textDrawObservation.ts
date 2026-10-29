import type { TextDrawPlan, TextPlanRect } from '../imaging/vectorContent/textDrawPlan'

/** 冻结作者库和宿主可能来自不同 bundle，以全局符号共享可选观察入口。 */
export const TEXT_DRAW_OBSERVER = Symbol.for('henji-layout.text.draw.v1')
/** getTransform 保留作者坐标；排版库另读实际栅格矩阵以覆盖宿主 pose 和预览缩放。 */
export const TEXT_RASTER_CONTEXT = Symbol.for('henji-layout.text.raster.v1')
/** 位图可被库的有界缓存关闭；录制重放按原规格恢复，不能持有已关闭的像素。 */
export const TEXT_BITMAP_RESTORE = Symbol.for('henji-layout.text.bitmap.restore.v1')
export type RestorableTextBitmap<T> = T & { [TEXT_BITMAP_RESTORE]?: () => T }
export const TEXT_LAYOUT_OBSERVER = Symbol.for('henji-layout.text.layout.v1')
export const TEXT_LAYER_CONTEXT = Symbol.for('henji-layout.text.layer.v1')
type LayoutObserver = (id: string) => void
export type TextLayoutObserverGlobal = typeof globalThis & { [TEXT_LAYOUT_OBSERVER]?: LayoutObserver }
/** 模块初始化的布局跨帧使用，随模块释放；不能混入另一效果的待绘制集合。 */
export const authorModuleTextLayouts = new WeakMap<object, ReadonlySet<string>>()
/** 作者回调同步执行，观察作用域不会跨 await 串到另一个效果。 */
export function observeTextLayouts<T>(observe: LayoutObserver, run: () => T): T {
  const host = globalThis as TextLayoutObserverGlobal, previous = host[TEXT_LAYOUT_OBSERVER]
  host[TEXT_LAYOUT_OBSERVER] = observe
  try { return run() } finally { host[TEXT_LAYOUT_OBSERVER] = previous }
}
export interface TextRasterContext {
  matrix: [number, number, number, number, number, number]
  colorSpace: 'srgb' | 'display-p3'
}
export type TextRasterProvider = {
  [TEXT_RASTER_CONTEXT]?: () => TextRasterContext
  /** Chromium 支持查询，WebWorker 类型库尚未声明；其他宿主沿用默认 sRGB。 */
  getContextAttributes?: () => { colorSpace?: TextRasterContext['colorSpace'] }
}
export interface TextDrawFact extends Pick<TextDrawPlan, 'sourceText' | 'box' | 'contentSize' | 'visibleContentSize' | 'inkBounds' | 'appearanceBounds' | 'boundsKind' | 'overflow' | 'truncated' | 'omittedRanges' | 'totalLines' | 'fit'> {
  layoutId?: string
  /** 字素揭示尚未完成时不能将有意省略当成正文缺失。 */
  revealComplete?: boolean
  /** 独立字素位姿的像素裁切尚无逐字几何证据，不能使用整段静态墨迹推断。 */
  animatedGraphemes?: boolean
  constraint: { x: number; y: number; width?: number; height?: number; maxWidth?: number; maxHeight?: number; maxLines?: number }
  actualLines: number
  /** 颜色、填充开关等逐字揭示也会改变绘制状态；不向能力回执展开整套样式。 */
  paintKey?: string
  bodyCoverage?: 'complete' | 'partial' | 'none'
}
export interface TextDrawObservation extends TextDrawFact {
  layerIndex?: number
  /** drawText 调用处到作者图层坐标的矩阵，不含栅格缩放。 */
  matrix: [number, number, number, number, number, number]
  /** 每个凸四边形都是一个有效裁切；空数组表示没有附加裁切。 */
  clips: Array<Array<[number, number]>>
  /** 栅格画布本身的边界，与作者声明的 clip 分开归因。 */
  canvasClip?: Array<[number, number]>
  stageClip?: [number, number, number, number]
  opacity: number
  uncovered: string[]
  retained?: boolean
}
export type TextDrawObserverContext = { [TEXT_DRAW_OBSERVER]?: (fact: TextDrawFact) => void; [TEXT_LAYER_CONTEXT]?: (index: number) => void }
export const textRectCorners = (rect: TextPlanRect): Array<[number, number]> => [[rect.x, rect.y], [rect.x + rect.width, rect.y], [rect.x + rect.width, rect.y + rect.height], [rect.x, rect.y + rect.height]]
