/**
 * 网页来源的取景：页面按 `width`×`height`（CSS 像素）的视口排版，只渲染其中 `region` 这一块，每 CSS 像素 `scale` 个
 * 设备像素。画面像素尺寸是 `round(region 宽·scale)`×`round(region 高·scale)`，每边不超过 `CODE_WEB_MAX_TEXTURE`。
 * 推近时把 region 缩到露出的部分、按需要提高 scale：画面像素数不随推近倍数增长，文字按设备像素栅格，不靠合成放大。
 * 同一个来源的取景与倍率整段固定，不随帧变化（变化会让页面重新栅格，文字抖动）。
 */
const CODE_WEB_DEFAULT_VIEWPORT = Object.freeze({ width: 1920, height: 1080 })
const CODE_WEB_DEFAULT_SCALE = 2
const CODE_WEB_MAX_SCALE = 16
/** WebGPU 默认的二维纹理每边上限。 */
const CODE_WEB_MAX_TEXTURE = 8192
/** 一个网页参数最多读取的元素选择器数与每个选择器的长度。 */
export const CODE_WEB_BOX_LIMIT = 64
export const CODE_WEB_SELECTOR_LENGTH = 512

export interface CodeWebView { width: number; height: number; region: [number, number, number, number]; scale: number }
interface CodeWebViewInput { width?: number; height?: number; region?: readonly number[]; scale?: number }

const integer = (value: unknown, min: number, max: number): boolean => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max

/** 取景不合法时的说明（用户语言）；合法为 undefined。 */
export function codeWebViewIssue(input: CodeWebViewInput): string | undefined {
  const width = input.width ?? CODE_WEB_DEFAULT_VIEWPORT.width, height = input.height ?? CODE_WEB_DEFAULT_VIEWPORT.height
  if (!integer(width, 1, 16384) || !integer(height, 1, 16384)) return '网页视口 width/height 需要 1–16384 的整数 CSS 像素。'
  const region = input.region ?? [0, 0, width, height]
  if (region.length !== 4 || !region.every(value => integer(value, 0, 16384))) return '网页取景 region 需要 [x, y, 宽, 高] 四个非负整数（视口 CSS 像素）。'
  const [x, y, w, h] = region
  if (w < 1 || h < 1 || x + w > width || y + h > height) return '网页取景 region 必须落在视口内，宽高至少 1。'
  const scale = input.scale ?? CODE_WEB_DEFAULT_SCALE
  if (typeof scale !== 'number' || !Number.isFinite(scale) || scale < 0.25 || scale > CODE_WEB_MAX_SCALE) return `网页渲染倍率 scale 需要 0.25–${CODE_WEB_MAX_SCALE}。`
  if (Math.round(w * scale) > CODE_WEB_MAX_TEXTURE || Math.round(h * scale) > CODE_WEB_MAX_TEXTURE) return `网页画面每边最多 ${CODE_WEB_MAX_TEXTURE} 像素：取景 ${w}×${h} 乘倍率 ${scale} 超出了，请缩小 region（只取露出的部分）或降低 scale。`
  return undefined
}

/** 补齐默认值后的取景；不合法时抛出。 */
export function codeWebView(input: CodeWebViewInput): CodeWebView {
  const issue = codeWebViewIssue(input)
  if (issue) throw new Error(issue)
  const width = input.width ?? CODE_WEB_DEFAULT_VIEWPORT.width, height = input.height ?? CODE_WEB_DEFAULT_VIEWPORT.height
  const [x, y, w, h] = input.region ?? [0, 0, width, height]
  return { width, height, region: [x, y, w, h], scale: input.scale ?? CODE_WEB_DEFAULT_SCALE }
}

/** 选择器列表不合法时的说明；合法为 undefined。 */
export function codeWebBoxesIssue(boxes: unknown): string | undefined {
  if (!Array.isArray(boxes) || boxes.length > CODE_WEB_BOX_LIMIT || !boxes.every(value => typeof value === 'string' && value.length >= 1 && value.length <= CODE_WEB_SELECTOR_LENGTH)) return `网页 boxes 需要最多 ${CODE_WEB_BOX_LIMIT} 个 CSS 选择器字符串。`
  return new Set(boxes).size === boxes.length ? undefined : '网页 boxes 里的选择器不能重复。'
}
