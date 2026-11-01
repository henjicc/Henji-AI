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
