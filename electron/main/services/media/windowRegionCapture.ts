import { BrowserWindow, type WebContents } from 'electron'

/** 页面里的一块矩形（CSS 像素，可以带小数） */
export interface WindowRegionCaptureRequest {
  x: number
  y: number
  width: number
  height: number
}

export interface WindowRegionCaptureResult {
  /** 实际截到的那块矩形（CSS 像素）：请求的矩形向内收到整像素之后的范围 */
  rect: { x: number; y: number; width: number; height: number }
  /** 画面（设备像素尺寸）的 JPEG 数据 */
  jpeg: Uint8Array
}

/**
 * 画面按高质量 JPEG 交还而不是原始像素：4K 窗口的原始像素有三十多兆，取出来、再经进程间传递要让主进程
 * 停一百多毫秒；编码成 JPEG 只要三十毫秒左右、几十到几百 KB，解码在渲染层的后台线程做。
 */
const JPEG_QUALITY = 95

export function parseWindowRegionCaptureRequest(input: unknown): WindowRegionCaptureRequest {
  const raw = (input ?? {}) as Record<string, unknown>
  const read = (key: string): number => {
    const value = raw[key]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`Invalid capture region field "${key}"`)
    return value
  }
  return { x: read('x'), y: read('y'), width: read('width'), height: read('height') }
}

/**
 * 截取发起方窗口里一块区域此刻显示的画面，不缩放。
 * 画布用它把已挂载的节点正文存成纹理，视口运动时由远景层代画。
 *
 * 页面量到的矩形带着界面缩放，截图接口收的是窗口坐标：这里换算，并把实际截到的范围按页面坐标交还，
 * 调用方据此对位，不受界面缩放与取整影响。
 */
export async function captureWindowRegion(sender: WebContents, request: WindowRegionCaptureRequest): Promise<WindowRegionCaptureResult> {
  const window = sender.isDestroyed() ? null : BrowserWindow.fromWebContents(sender)
  if (!window || window.isDestroyed() || window.webContents.id !== sender.id) throw new Error('WINDOW_CAPTURE_UNAVAILABLE')
  const zoom = sender.getZoomFactor()
  const [contentWidth, contentHeight] = window.getContentSize()
  const x = Math.ceil(request.x * zoom), y = Math.ceil(request.y * zoom)
  const right = Math.min(contentWidth, Math.floor((request.x + request.width) * zoom))
  const bottom = Math.min(contentHeight, Math.floor((request.y + request.height) * zoom))
  if (right <= x || bottom <= y) throw new Error('WINDOW_CAPTURE_OUT_OF_BOUNDS')
  const image = await sender.capturePage({ x, y, width: right - x, height: bottom - y })
  if (image.isEmpty()) throw new Error('WINDOW_CAPTURE_EMPTY')
  return { rect: { x: x / zoom, y: y / zoom, width: (right - x) / zoom, height: (bottom - y) / zoom }, jpeg: image.toJPEG(JPEG_QUALITY) }
}
