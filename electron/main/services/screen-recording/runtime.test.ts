import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import type { BrowserWindow, WebContents } from 'electron'
import { closeRecordingControl, minimizeOwnerWhileRecording, openRecordingControl, recordRecordingCapability, updateRecordingTracks } from './runtime'

const hooks = vi.hoisted(() => { const release = vi.fn(); return { capture: vi.fn(), options: vi.fn(), revoke: vi.fn(), release, hold: vi.fn(() => release) } })
vi.mock('electron', () => ({ globalShortcut: { register: () => true, unregister: vi.fn() } }))
vi.mock('../recording-power', () => ({ holdRecordingWakeLock: hooks.hold }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), error: vi.fn() }) }))
vi.mock('../media-permissions', () => ({ mediaPermissions: { revoke: hooks.revoke } }))
vi.mock('../../security/main-renderer-url', () => ({ isTrustedMainRendererUrl: (url: string) => url === 'app://henji' }))
vi.mock('./events', () => ({ RecordingEventSession: class {
  constructor(options: unknown) { hooks.options(options) }
  capability = hooks.capture
  wrap(backend: unknown) { return backend }
} }))
vi.mock('../../windows/recording-control', () => ({ createRecordingControlWindow: () => Object.assign(new EventEmitter(), { webContents: { isDestroyed: () => false, send: vi.fn() }, getBounds: () => ({ x: 100, y: 100, width: 200, height: 50 }), getNativeWindowHandle: () => Buffer.from([99, 0, 0, 0]), isDestroyed: () => false, destroy: vi.fn() }) }))
vi.mock('../../windows/recording-frame', () => ({ createRecordingFrameWindow: () => null }))
afterEach(async () => { await closeRecordingControl(); vi.clearAllMocks() })
function contents(url = 'app://henji'): WebContents { return Object.assign(new EventEmitter(), { getURL: () => url, isDestroyed: () => false, send: vi.fn() }) as unknown as WebContents }
it('能力记录只接受归属宿主及当前会话；控制条区域和原生句柄纳入排除', async () => {
  const owner = contents(); const backend = { start: vi.fn(), pause: vi.fn(), resume: vi.fn(), mark: vi.fn(), stop: vi.fn(), cancel: vi.fn() }
  const options = { ownerRef: { kind: 'screen_recording.session', id: 'live' }, sourceDigest: `sha256:${'a'.repeat(64)}`, directory: 'unused', originUs: 0, nowUs: () => 0, geometry: () => ({ bounds: { x: 0, y: 0, width: 1000, height: 800 }, pixels: { width: 1000, height: 800 } }), onFailure: vi.fn() }
  openRecordingControl(owner, 'live', backend, options)
  const status = { cameraPreview: null, warnings: [] }
  expect(() => updateRecordingTracks(contents(), 'live', status)).toThrow('不属于')
  expect(() => updateRecordingTracks(owner, 'old', status)).toThrow('不属于')
  updateRecordingTracks(owner, 'live', status)
  const fact = { callId: 'call', capability: 'read_application_entity', targets: [], phase: 'completed' as const }
  recordRecordingCapability(contents(), 'live', fact); recordRecordingCapability(owner, 'old', fact)
  expect(hooks.capture).not.toHaveBeenCalled()
  recordRecordingCapability(owner, 'live', fact); expect(hooks.capture).toHaveBeenCalledTimes(1)
  const injected = hooks.options.mock.calls[0][0]
  expect(injected.excludedRegions()).toEqual([{ x: 100, y: 100, width: 200, height: 50 }])
  if (process.platform === 'win32') expect(injected.excludedWindowIds).toContain('99')
  await closeRecordingControl(); recordRecordingCapability(owner, 'live', fact)
  expect(hooks.capture).toHaveBeenCalledTimes(1); expect(backend.cancel).toHaveBeenCalledTimes(1)
})
it('主窗口在另一块屏上不最小化，与被录范围重叠才最小化', () => {
  const window = (x: number) => ({ isDestroyed: () => false, isMinimized: () => false, getBounds: () => ({ x, y: 0, width: 1600, height: 900 }), minimize: vi.fn(), restore: vi.fn(), focus: vi.fn() })
  const leftScreen = { x: 0, y: 0, width: 2560, height: 1440 }
  const elsewhere = window(2560)
  minimizeOwnerWhileRecording(elsewhere as unknown as BrowserWindow, leftScreen)
  expect(elsewhere.minimize).not.toHaveBeenCalled()
  const same = window(200)
  minimizeOwnerWhileRecording(same as unknown as BrowserWindow, leftScreen)
  expect(same.minimize).toHaveBeenCalledOnce()
})
it('录屏会话期间阻止系统睡眠，会话结束恰好释放一次', async () => {
  const backend = { start: vi.fn(), pause: vi.fn(), resume: vi.fn(), mark: vi.fn(), stop: vi.fn(), cancel: vi.fn() }
  openRecordingControl(contents(), 'sleep', backend)
  expect(hooks.hold).toHaveBeenCalledOnce(); expect(hooks.release).not.toHaveBeenCalled()
  await closeRecordingControl(); await closeRecordingControl()
  expect(hooks.release).toHaveBeenCalledOnce()
})
it('导航开始后被拦下不放开录制，主文档换掉才交给宿主断开处理', () => {
  const owner = contents(); const lost = vi.fn()
  const backend = { start: vi.fn(), pause: vi.fn(), resume: vi.fn(), mark: vi.fn(), stop: vi.fn(), cancel: vi.fn() }
  openRecordingControl(owner, 'nav', backend, undefined, undefined, undefined, lost)
  const emitter = owner as unknown as EventEmitter
  emitter.emit('did-start-navigation', {}, 'app://henji/other', false, true)
  emitter.emit('did-fail-provisional-load', {}, -3, 'ERR_ABORTED', 'app://henji/other', true)
  expect(lost).not.toHaveBeenCalled(); expect(backend.cancel).not.toHaveBeenCalled(); expect(hooks.release).not.toHaveBeenCalled()
  emitter.emit('did-navigate', {}, 'app://henji/other')
  expect(lost).toHaveBeenCalledOnce()
})
