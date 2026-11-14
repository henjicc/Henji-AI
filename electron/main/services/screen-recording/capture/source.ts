import { screen } from 'electron'
import koffi from 'koffi'
import type { CaptureSource } from '../../../../../src/core/screenRecording/contracts'
import type { NativeCaptureSource } from './gfxcapture'

/**
 * 物理坐标所在显示器的句柄。直接调系统接口，不起 PowerShell：隐藏窗口里编码执行脚本、现场编译调用系统接口，
 * 正是安全软件盯的特征，每次开始录屏都会弹告警。按每显示器 DPI 感知查询，查完恢复线程原来的设置。
 */
let monitorApi: { fromPoint(point: { x: number; y: number }, flags: number): number; dpiContext(context: number): number } | undefined
function monitorFromPhysicalPoint(x: number, y: number): number {
  if (!monitorApi) {
    const user32 = koffi.load('user32.dll')
    const point = koffi.struct({ x: 'int32', y: 'int32' })
    monitorApi = { fromPoint: user32.func('__stdcall', 'MonitorFromPoint', 'intptr_t', [point, 'uint32']), dpiContext: user32.func('__stdcall', 'SetThreadDpiAwarenessContext', 'intptr_t', ['intptr_t']) }
  }
  const previous = monitorApi.dpiContext(-4)
  try { return monitorApi.fromPoint({ x, y }, 0) } finally { if (previous) monitorApi.dpiContext(previous) }
}

/** Electron/WebRTC source indices and EnumDisplayMonitors indices are different namespaces. */
export async function resolveNativeCaptureSource(source: CaptureSource): Promise<NativeCaptureSource> {
  if (source.kind === 'window') return { selector: 'hwnd', handle: source.id.split(':')[1], width: 0, height: 0 }
  const display = screen.getAllDisplays().find(item => String(item.id) === source.displayId)
  if (!display) throw new Error('所选显示器已断开，请重新选择')
  const point = screen.dipToScreenPoint({ x: display.bounds.x + display.bounds.width / 2, y: display.bounds.y + display.bounds.height / 2 })
  const handle = String(monitorFromPhysicalPoint(Math.round(point.x), Math.round(point.y)))
  if (!/^\d+$/.test(handle) || handle === '0') throw new Error('无法定位所选显示器，请改用兼容录制')
  return { selector: 'hmonitor', handle, width: Math.round(display.bounds.width * display.scaleFactor), height: Math.round(display.bounds.height * display.scaleFactor) }
}
