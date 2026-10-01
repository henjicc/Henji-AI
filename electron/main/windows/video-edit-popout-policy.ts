import type { Display, Rectangle } from 'electron'

/**
 * 剪辑系统浮窗的开窗白名单。渲染层只允许以 `about:blank` + 此前缀的 frameName 打开浮窗，
 * 内容由主窗口同一 JS 堆通过 React portal 渲染；子窗口不加载任何页面、不注入 preload。
 * 渲染层 `src/features/videoEdit/layout/popout/videoEditPopoutWindow.ts` 持有同值常量。
 */
export const VIDEO_EDIT_POPOUT_FRAME_PREFIX = 'henji-video-edit-popout:'
export const VIDEO_EDIT_POPOUT_MAX_WINDOWS = 6
export const VIDEO_EDIT_POPOUT_MIN_SIZE = { width: 320, height: 200 } as const
const DEFAULT_SIZE = { width: 480, height: 640 } as const
const MAX_SIZE = 8192
const PANEL_KEY = /^[a-z][a-z0-9-]{0,31}$/
/** 标题栏至少露出这么多才算用户还能抓住窗口。 */
const GRAB_WIDTH = 120
const GRAB_HEIGHT = 16
const TITLE_STRIP = 32

/** 主窗口标题；Reality 与宿主以它识别主窗口，浮窗标题必须与之区分。 */
const MAIN_WINDOW_TITLE = '痕迹AI'
const POPOUT_TITLE_PREFIX = `${MAIN_WINDOW_TITLE} · `
export const VIDEO_EDIT_POPOUT_DEFAULT_TITLE = `${POPOUT_TITLE_PREFIX}剪辑面板`
const MAX_TITLE_NAME = 64
const POPOUT_TITLE_PATTERN = /^痕迹AI\s*·\s*/

/**
 * 浮窗原生标题：渲染层写入面板名（document.title），这里统一成 `痕迹AI · <面板名>`；
 * 空标题、与主窗口同名或只有前缀时回落默认标题，保证永不与主窗口标题相同。
 */
export function resolveVideoEditPopoutTitle(pageTitle: string): string {
  const name = pageTitle.trim().replace(POPOUT_TITLE_PATTERN, '').trim()
  if (!name || name === MAIN_WINDOW_TITLE) return VIDEO_EDIT_POPOUT_DEFAULT_TITLE
  return `${POPOUT_TITLE_PREFIX}${name.slice(0, MAX_TITLE_NAME)}`
}

/** `position` 来自渲染层记住的上次位置（features 的 left/top），仍须经显示器修复后使用。 */
export interface VideoEditPopoutRequest { panelKey: string; size: { width: number; height: number }; position?: { x: number; y: number }; title: string }
interface OpenDetails { url: string; frameName: string; disposition: string; features: string }

/** 只接受指定前缀的受控空白页；外部地址、任意 frameName、非新窗口语义一律拒绝。 */
export function parseVideoEditPopoutRequest(details: OpenDetails): VideoEditPopoutRequest | null {
  if (details.url !== 'about:blank' || details.disposition !== 'new-window') return null
  if (!details.frameName.startsWith(VIDEO_EDIT_POPOUT_FRAME_PREFIX)) return null
  const panelKey = details.frameName.slice(VIDEO_EDIT_POPOUT_FRAME_PREFIX.length)
  if (!PANEL_KEY.test(panelKey)) return null
  const values = parseFeatures(details.features)
  const left = values.get('left'); const top = values.get('top')
  return { panelKey, size: parseFeatureSize(values), title: resolveVideoEditPopoutTitle(parseFeatureTitle(details.features)), ...(left !== undefined && top !== undefined ? { position: { x: left, y: top } } : {}) }
}

/** 渲染层以 `henjiTitle=<URI 编码>` 传面板名，使浮窗创建时就有正确标题；非法编码按空标题处理。 */
function parseFeatureTitle(features: string): string {
  const part = features.split(',').map(value => value.trim()).find(value => /^henjititle=/i.test(value))
  if (!part) return ''
  try { return decodeURIComponent(part.slice(part.indexOf('=') + 1)).slice(0, 200) } catch { return '' }
}

function parseFeatures(features: string): Map<string, number> {
  const values = new Map<string, number>()
  for (const part of features.split(',')) {
    const [key, raw] = part.split('=').map(value => value.trim().toLowerCase())
    if (!key || raw === undefined) continue
    // 位置可为负（主屏左侧/上方的显示器）；尺寸只接受正整数。
    if ((key === 'left' || key === 'top') ? !/^-?\d{1,6}$/.test(raw) : !/^\d{1,5}$/.test(raw)) continue
    values.set(key, Number(raw))
  }
  return values
}

function parseFeatureSize(values: Map<string, number>): { width: number; height: number } {
  const clamp = (value: number | undefined, fallback: number, min: number): number => value === undefined ? fallback : Math.min(MAX_SIZE, Math.max(min, value))
  return {
    width: clamp(values.get('width'), DEFAULT_SIZE.width, VIDEO_EDIT_POPOUT_MIN_SIZE.width),
    height: clamp(values.get('height'), DEFAULT_SIZE.height, VIDEO_EDIT_POPOUT_MIN_SIZE.height),
  }
}

type DisplayArea = Pick<Display, 'workArea'>

function overlap(a: Rectangle, b: Rectangle): { width: number; height: number } {
  return {
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)),
  }
}

function grabbable(bounds: Rectangle, displays: readonly DisplayArea[]): DisplayArea | undefined {
  const title = { x: bounds.x, y: bounds.y, width: bounds.width, height: Math.min(TITLE_STRIP, bounds.height) }
  return displays.find(({ workArea }) => {
    const area = overlap(title, workArea)
    return area.width >= Math.min(GRAB_WIDTH, bounds.width) && area.height >= Math.min(GRAB_HEIGHT, title.height)
  })
}

function centered(size: { width: number; height: number }, workArea: Rectangle): Rectangle {
  const width = Math.min(size.width, workArea.width)
  const height = Math.min(size.height, workArea.height)
  return {
    x: workArea.x + Math.max(0, Math.floor((workArea.width - width) / 2)),
    y: workArea.y + Math.max(0, Math.floor((workArea.height - height) / 2)),
    width, height,
  }
}

/**
 * 计算浮窗首次显示的位置：优先恢复同一面板上次的位置；上次位置所在显示器已拔除或标题栏
 * 不可抓取时，回落到主窗口所在显示器工作区居中。尺寸不超过目标工作区。
 */
export function resolveVideoEditPopoutBounds(
  remembered: Rectangle | undefined,
  size: { width: number; height: number },
  displays: readonly DisplayArea[],
  fallbackWorkArea: Rectangle,
): Rectangle {
  if (remembered) {
    const repaired = repairVideoEditPopoutBounds(remembered, displays, fallbackWorkArea)
    if (repaired) return repaired
    return remembered
  }
  return centered(size, fallbackWorkArea)
}

/**
 * 显示器拔除或缩放变化后修复浮窗位置；无需修复时返回 null。
 * 只要标题栏仍可抓取就保留用户位置，只把超出工作区的尺寸收回。
 */
export function repairVideoEditPopoutBounds(
  bounds: Rectangle,
  displays: readonly DisplayArea[],
  fallbackWorkArea: Rectangle,
): Rectangle | null {
  const host = grabbable(bounds, displays)
  if (!host) return centered(bounds, fallbackWorkArea)
  const width = Math.min(bounds.width, host.workArea.width)
  const height = Math.min(bounds.height, host.workArea.height)
  if (width === bounds.width && height === bounds.height) return null
  return { ...bounds, width, height }
}

/**
 * 实际外框与期望不符时，返回抵消偏差后的下一次请求；已一致（±0）返回 null。
 * 用于抵消平台在小数缩放下的外框取整偏差，使记录与恢复使用同一外框语义。
 */
export function compensateVideoEditPopoutBounds(request: Rectangle, actual: Rectangle, intended: Rectangle): Rectangle | null {
  if (actual.x === intended.x && actual.y === intended.y && actual.width === intended.width && actual.height === intended.height) return null
  return {
    x: request.x - (actual.x - intended.x),
    y: request.y - (actual.y - intended.y),
    width: Math.max(VIDEO_EDIT_POPOUT_MIN_SIZE.width, request.width - (actual.width - intended.width)),
    height: Math.max(VIDEO_EDIT_POPOUT_MIN_SIZE.height, request.height - (actual.height - intended.height)),
  }
}
