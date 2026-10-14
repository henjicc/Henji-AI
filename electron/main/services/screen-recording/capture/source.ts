import { screen } from 'electron'
import { execFile } from 'node:child_process'
import type { CaptureSource } from '../../../../../src/core/screenRecording/contracts'
import type { NativeCaptureSource } from './gfxcapture'

/** Electron/WebRTC source indices and EnumDisplayMonitors indices are different namespaces. */
export async function resolveNativeCaptureSource(source: CaptureSource): Promise<NativeCaptureSource> {
  if (source.kind === 'window') return { selector: 'hwnd', handle: source.id.split(':')[1], width: 0, height: 0 }
  const display = screen.getAllDisplays().find(item => String(item.id) === source.displayId)
  if (!display) throw new Error('所选显示器已断开，请重新选择')
  const point = screen.dipToScreenPoint({ x: display.bounds.x + display.bounds.width / 2, y: display.bounds.y + display.bounds.height / 2 })
  // Fixed Win32 query, numeric coordinates only; no user script, title, path or command interpolation.
  const script = `$ProgressPreference='SilentlyContinue'; Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class HenjiMonitor { [StructLayout(LayoutKind.Sequential)] public struct Point { public int X; public int Y; } [DllImport("user32.dll")] public static extern IntPtr MonitorFromPoint(Point p, uint flags); [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c); public static long Find(int x,int y) { SetThreadDpiAwarenessContext(new IntPtr(-4)); return MonitorFromPoint(new Point { X=x,Y=y },0).ToInt64(); } }'; [HenjiMonitor]::Find(${Math.round(point.x)},${Math.round(point.y)})`
  const handle = await new Promise<string>((resolve, reject) => execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 10000, maxBuffer: 65536 }, (error, stdout) => error ? reject(error) : resolve(stdout.trim())))
  if (!/^\d+$/.test(handle) || handle === '0') throw new Error('无法定位所选显示器，请改用兼容录制')
  return { selector: 'hmonitor', handle, width: Math.round(display.bounds.width * display.scaleFactor), height: Math.round(display.bounds.height * display.scaleFactor) }
}
