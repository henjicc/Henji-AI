import { expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ exec: vi.fn(), point: vi.fn(() => ({ x: 5760, y: 1080 })) }))
vi.mock('electron', () => ({ screen: { getAllDisplays: () => [{ id: 7, bounds: { x: 2560, y: 0, width: 2560, height: 1440 }, scaleFactor: 1.5 }], dipToScreenPoint: mocks.point } }))
vi.mock('node:child_process', () => ({ execFile: mocks.exec }))
import { resolveNativeCaptureSource } from './source'
it('uses the matched display physical point and a per-monitor-aware Win32 query at 150% DPI', async () => {
  mocks.exec.mockImplementation((_program: string, _args: string[], _options: object, callback: (error: Error | null, stdout: string) => void) => callback(null, '65539\r\n'))
  expect(await resolveNativeCaptureSource({ id: 'screen:0:0', kind: 'screen', name: '副屏', displayId: '7' })).toEqual({ selector: 'hmonitor', handle: '65539', width: 3840, height: 2160 })
  expect(mocks.point).toHaveBeenCalledWith({ x: 3840, y: 720 })
  const script = Buffer.from(mocks.exec.mock.calls[0][1].at(-1) as string, 'base64').toString('utf16le')
  expect(script).toContain('SetThreadDpiAwarenessContext(new IntPtr(-4))')
  expect(script).toContain('Find(5760,1080)')
  await expect(resolveNativeCaptureSource({ id: 'screen:0:0', kind: 'screen', name: '已断开', displayId: '8' })).rejects.toThrow('断开')
})
