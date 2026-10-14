import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { CaptureLogPage } from '../../../../src/core/captureLog/events'
import { RecordingEventSession } from './events'

const hooks = vi.hoisted(() => ({ attach: vi.fn(), detach: vi.fn(), write: vi.fn(), cursor: vi.fn(), point: vi.fn(), foreground: vi.fn() }))
vi.mock('electron', () => ({ screen: { getCursorScreenPoint: hooks.point, screenToDipPoint: (point: { x: number; y: number }) => ({ x: point.x / 2, y: point.y / 2 }) } }))
vi.mock('./input-events', () => ({ startDesktopInput: hooks.attach }))
vi.mock('./windows-events', () => ({ createWindowsEventFacts: () => ({ cursor: hooks.cursor, foreground: hooks.foreground }) }))
vi.mock('./event-store', () => ({ RecordingEventStore: class { write = hooks.write } }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), error: vi.fn() }) }))
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(0)
  hooks.attach.mockReturnValue(hooks.detach); hooks.write.mockResolvedValue(undefined)
  hooks.cursor.mockReturnValue('arrow'); hooks.point.mockReturnValue({ x: -200, y: 100 })
  hooks.foreground.mockReturnValue({ windowId: 'window', bounds: { x: -800, y: 0, width: 800, height: 600 }, available: true })
})
afterEach(() => { vi.useRealTimers() })
function fixture() {
  const onFailure = vi.fn()
  const session = new RecordingEventSession({ ownerRef: { kind: 'screen_recording.session', id: 's' }, sourceDigest: `sha256:${'c'.repeat(64)}`, directory: 'unused', originUs: 10000, nowUs: () => 10000 + Date.now() * 1000, geometry: () => ({ bounds: { x: -400, y: 0, width: 400, height: 300 }, pixels: { width: 800, height: 600 } }), excludedWindowIds: ['excluded'], excludedRegions: () => [{ x: -100, y: 0, width: 100, height: 50 }], onFailure })
  const backend = { start: vi.fn(async () => {}), pause: vi.fn(async () => {}), resume: vi.fn(async () => {}), mark: vi.fn(async () => {}), stop: vi.fn(async () => {}), cancel: vi.fn(async () => {}) }
  return { session, onFailure, backend, wrapped: session.wrap(backend), signal: new AbortController() }
}
const pages = (): CaptureLogPage[] => hooks.write.mock.calls.map(([page]) => page as CaptureLogPage)
it('密码框几何按源/DPI归一化，准备/暂停/排除窗口不采集，也不接受原文', async () => {
  const f = fixture(), regions = [{ id: 'dom', bounds: { x: -300, y: 100, width: 100, height: 30 } }]
  f.session.sensitive(regions)
  await f.wrapped.start(f.signal.signal); f.session.sensitive(regions)
  await f.wrapped.pause(f.signal.signal); f.session.sensitive(regions)
  await f.wrapped.resume(f.signal.signal); hooks.foreground.mockReturnValue({ windowId: 'excluded', bounds: null, available: true }); f.session.sensitive(regions)
  await f.wrapped.stop(f.signal.signal)
  const events = pages().flatMap(page => page.entries).filter(event => event.kind === 'sensitive')
  expect(events).toHaveLength(1); expect(events[0]).toMatchObject({ regions: [{ id: 'dom', box: [.25, 1 / 3, .25, .1] }] })
  expect(pages().every(page => page.version === 2)).toBe(true)
})
it('只在后端开始之后挂钩；120Hz真实采样，暂停卸载、恢复重挂；标记备注和能力事实可回读', async () => {
  const f = fixture(); expect(hooks.attach).not.toHaveBeenCalled()
  await f.wrapped.start(f.signal.signal); await vi.advanceTimersByTimeAsync(1000)
  await f.wrapped.mark(f.signal.signal, '讲解重点')
  f.session.capability({ callId: 'call', capability: 'read_application_entity', targets: [{ kind: 'settings.registry', id: 'singleton' }], phase: 'started' })
  await f.wrapped.pause(f.signal.signal)
  const pausedWrites = hooks.write.mock.calls.length
  await vi.advanceTimersByTimeAsync(1000)
  f.session.capability({ callId: 'paused', capability: 'read_application_entity', targets: [], phase: 'completed' })
  expect(hooks.write).toHaveBeenCalledTimes(pausedWrites); expect(hooks.detach).toHaveBeenCalledTimes(1)
  await f.wrapped.resume(f.signal.signal); await vi.advanceTimersByTimeAsync(100)
  await f.wrapped.stop(f.signal.signal)
  const events = pages().flatMap(page => page.entries)
  expect(events.filter(event => event.kind === 'cursor').length).toBeGreaterThanOrEqual(130)
  expect(events.filter(event => event.kind === 'cursor').length).toBeLessThan(140)
  expect(events.find(event => event.kind === 'mark')).toMatchObject({ note: '讲解重点' })
  expect(events.filter(event => event.kind === 'capability')).toHaveLength(1)
  expect(hooks.attach).toHaveBeenCalledTimes(2); expect(hooks.detach).toHaveBeenCalledTimes(2)
})
it('被排除窗口和控制条区域不留下轨迹位置或点击；源外点击不伪造边缘点', async () => {
  const f = fixture(); await f.wrapped.start(f.signal.signal)
  const emit = hooks.attach.mock.calls[0][0]
  emit({ kind: 'mouse', event: { type: 7, x: -400, y: 200, button: 1 } })
  emit({ kind: 'mouse', event: { type: 7, x: 9000, y: 9000, button: 1 } })
  hooks.foreground.mockReturnValue({ windowId: 'excluded', bounds: null, available: true })
  emit({ kind: 'key', category: 'typing' }); await vi.advanceTimersByTimeAsync(20)
  hooks.foreground.mockReturnValue({ windowId: 'window', bounds: null, available: true })
  hooks.point.mockReturnValue({ x: -50, y: 10 }); await vi.advanceTimersByTimeAsync(20)
  emit({ kind: 'mouse', event: { type: 7, x: -100, y: 20, button: 1 } })
  await f.wrapped.stop(f.signal.signal)
  const events = pages().flatMap(page => page.entries)
  expect(events.filter(event => event.kind === 'click')).toHaveLength(1)
  expect(events.filter(event => event.kind === 'key')).toHaveLength(0)
  expect(events.filter(event => event.kind === 'cursor' && event.shape === 'hidden').every(event => event.kind === 'cursor' && event.point === null)).toBe(true)
})
it('输入启动/标记失败释放资源，停止落盘失败仍停止媒体后端并向上报错', async () => {
  const f = fixture(); hooks.attach.mockImplementationOnce(() => { throw new Error('input denied') })
  await expect(f.wrapped.start(f.signal.signal)).rejects.toThrow('input denied'); expect(f.backend.cancel).toHaveBeenCalled()
  const saving = fixture(); await saving.wrapped.start(saving.signal.signal)
  hooks.write.mockRejectedValueOnce(new Error('disk full'))
  await expect(saving.wrapped.stop(saving.signal.signal)).rejects.toThrow('disk full')
  expect(saving.backend.stop).toHaveBeenCalled(); expect(saving.onFailure).toHaveBeenCalled()
  expect(hooks.detach).toHaveBeenCalled()
})
it('宿主取消时正在等待的开始完成后不会重新挂钩', async () => {
  const f = fixture(); let finish!: () => void
  f.backend.start.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const pending = f.wrapped.start(f.signal.signal)
  f.signal.abort(); await f.wrapped.cancel(); finish()
  await expect(pending).rejects.toThrow('录制已取消')
  expect(hooks.attach).not.toHaveBeenCalled(); expect(f.backend.cancel).toHaveBeenCalled()
})
