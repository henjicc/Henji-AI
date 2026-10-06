import type { Display, Rectangle } from 'electron'

/**
 * 剪辑系统浮窗的开窗白名单。渲染层只允许以 `about:blank` + 此前缀的 frameName 打开浮窗，
 * 内容由主窗口同一 JS 堆通过 React portal 渲染；子窗口不加载任何页面、不注入 preload。
 * 渲染层 `src/features/videoEdit/layout/popout/videoEditPopoutWindow.ts` 持有同值常量。
 */
export const VIDEO_EDIT_POPOUT_FRAME_PREFIX = 'henji-video-edit-popout:'
export const VIDEO_EDIT_POPOUT_MAX_WINDOWS = 6
export const VIDEO_EDIT_POPOUT_MIN_SIZE = { width: 320, height: 200 } as const
/** 渲染层自绘标题栏的高度（与 `videoEditPopouts.ts` 的 VIDEO_EDIT_POPOUT_TITLEBAR_HEIGHT 同值）。 */
export const VIDEO_EDIT_POPOUT_TITLEBAR_HEIGHT = 32
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

/**
 * Windows 无边框窗口（带系统缩放边框）的隐形边框：渲染层的 `window.screenX/outerWidth`、`moveTo/resizeTo`
 * 以含隐形边框的窗口矩形计，BrowserWindow 外框不含。实测 150% 缩放下左、右、下各 7、上 0（DIP）。
 */
export interface VideoEditPopoutFrameInsets { left: number; top: number; right: number; bottom: number }
export const VIDEO_EDIT_POPOUT_NO_INSETS: VideoEditPopoutFrameInsets = { left: 0, top: 0, right: 0, bottom: 0 }
const MAX_INSET = 32

/** 由渲染层看到的窗口矩形与 BrowserWindow 外框算出隐形边框；数值异常时按无边框处理。 */
export function measureVideoEditPopoutFrameInsets(view: readonly unknown[], bounds: Rectangle): VideoEditPopoutFrameInsets {
  const [x, y, width, height] = view
  if (![x, y, width, height].every(value => typeof value === 'number' && Number.isFinite(value))) return VIDEO_EDIT_POPOUT_NO_INSETS
  const raw = {
    left: bounds.x - (x as number), top: bounds.y - (y as number),
    right: (x as number) + (width as number) - bounds.x - bounds.width, bottom: (y as number) + (height as number) - bounds.y - bounds.height,
  }
  return Object.values(raw).every(value => Number.isInteger(value) && value >= 0 && value <= MAX_INSET) ? raw : VIDEO_EDIT_POPOUT_NO_INSETS
}

/** 渲染层的窗口矩形（含隐形边框）→ BrowserWindow 外框。 */
export function viewRectToVideoEditPopoutBounds(rect: Rectangle, insets: VideoEditPopoutFrameInsets): Rectangle {
  return {
    x: Math.round(rect.x + insets.left), y: Math.round(rect.y + insets.top),
    width: Math.max(1, Math.round(rect.width - insets.left - insets.right)), height: Math.max(1, Math.round(rect.height - insets.top - insets.bottom)),
  }
}

/** 渲染层请求的矩形正好是某个显示器的可用区域（标题栏双击最大化）：返回该显示器。 */
export function matchVideoEditPopoutWorkArea<T extends DisplayArea>(rect: Rectangle, displays: readonly T[]): T | undefined {
  return displays.find(({ workArea }) => Math.abs(rect.x - workArea.x) <= 1 && Math.abs(rect.y - workArea.y) <= 1 && Math.abs(rect.width - workArea.width) <= 1 && Math.abs(rect.height - workArea.height) <= 1)
}

/** 主窗口代为移动、收起、最大化浮窗的请求（与渲染层 `WindowPopoutControlRequest` 同形）。 */
export type VideoEditPopoutControlRequest =
  | { panelKey: string; action: 'begin-move' | 'move'; x: number; y: number }
  | { panelKey: string; action: 'end-move' | 'collapse' | 'expand' | 'toggle-maximize' }
const POINT_ACTIONS = new Set(['begin-move', 'move'])
const PLAIN_ACTIONS = new Set(['end-move', 'collapse', 'expand', 'toggle-maximize'])

export function parseVideoEditPopoutControl(input: unknown): VideoEditPopoutControlRequest {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('Expected popout control object')
  const { panelKey, action, x, y } = input as Record<string, unknown>
  if (typeof panelKey !== 'string' || !PANEL_KEY.test(panelKey)) throw new Error('Invalid popout panel key')
  if (typeof action === 'string' && PLAIN_ACTIONS.has(action)) return { panelKey, action: action as 'end-move' }
  const coordinate = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 100_000
  if (typeof action === 'string' && POINT_ACTIONS.has(action) && coordinate(x) && coordinate(y)) return { panelKey, action: action as 'move', x, y }
  throw new Error('Invalid popout control action')
}
