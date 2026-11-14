import { expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ point: vi.fn(() => ({ x: 5760, y: 1080 })), fromPoint: vi.fn(() => 65539), dpiContext: vi.fn((_context: number) => 18) }))
vi.mock('electron', () => ({ screen: { getAllDisplays: () => [{ id: 7, bounds: { x: 2560, y: 0, width: 2560, height: 1440 }, scaleFactor: 1.5 }], dipToScreenPoint: mocks.point } }))
vi.mock('koffi', () => ({ default: { struct: () => ({}), load: () => ({ func: (_convention: string, name: string) => name === 'MonitorFromPoint' ? mocks.fromPoint : mocks.dpiContext }) } }))
import { resolveNativeCaptureSource } from './source'
it('uses the matched display physical point and a per-monitor-aware Win32 query at 150% DPI', async () => {
  expect(await resolveNativeCaptureSource({ id: 'screen:0:0', kind: 'screen', name: '副屏', displayId: '7' })).toEqual({ selector: 'hmonitor', handle: '65539', width: 3840, height: 2160 })
  expect(mocks.point).toHaveBeenCalledWith({ x: 3840, y: 720 })
  expect(mocks.fromPoint).toHaveBeenCalledWith({ x: 5760, y: 1080 }, 0)
  // 查询前切到每显示器 DPI 感知（-4），查完恢复线程原来的设置
  expect(mocks.dpiContext.mock.calls.map(([context]) => context)).toEqual([-4, 18])
  await expect(resolveNativeCaptureSource({ id: 'screen:0:0', kind: 'screen', name: '已断开', displayId: '8' })).rejects.toThrow('断开')
})
