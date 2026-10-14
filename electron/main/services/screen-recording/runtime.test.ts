import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import { closeRecordingControl, openRecordingControl, recordRecordingCapability, updateRecordingTracks } from './runtime'

const hooks = vi.hoisted(() => ({ capture: vi.fn(), options: vi.fn(), revoke: vi.fn() }))
vi.mock('electron', () => ({ globalShortcut: { register: () => true, unregister: vi.fn() } }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), error: vi.fn() }) }))
vi.mock('../media-permissions', () => ({ mediaPermissions: { revoke: hooks.revoke } }))
vi.mock('../../security/main-renderer-url', () => ({ isTrustedMainRendererUrl: (url: string) => url === 'app://henji' }))
vi.mock('./events', () => ({ RecordingEventSession: class {
  constructor(options: unknown) { hooks.options(options) }
  capability = hooks.capture
  wrap(backend: unknown) { return backend }
} }))
vi.mock('../../windows/recording-control', () => ({ createRecordingControlWindow: () => Object.assign(new EventEmitter(), { webContents: { isDestroyed: () => false, send: vi.fn() }, getBounds: () => ({ x: 100, y: 100, width: 200, height: 50 }), getNativeWindowHandle: () => Buffer.from([99, 0, 0, 0]), isDestroyed: () => false, destroy: vi.fn() }) }))
afterEach(async () => { await closeRecordingControl(); vi.clearAllMocks() })
function contents(url = 'app://henji'): WebContents { return Object.assign(new EventEmitter(), { getURL: () => url, isDestroyed: () => false, send: vi.fn() }) as unknown as WebContents }
it('能力记录只接受归属宿主及当前会话；控制条区域和原生句柄纳入排除', async () => {
  const owner = contents(); const backend = { start: vi.fn(), pause: vi.fn(), resume: vi.fn(), mark: vi.fn(), stop: vi.fn(), cancel: vi.fn() }
  const options = { ownerRef: { kind: 'screen_recording.session', id: 'live' }, sourceDigest: `sha256:${'a'.repeat(64)}`, directory: 'unused', originUs: 0, nowUs: () => 0, geometry: () => ({ bounds: { x: 0, y: 0, width: 1000, height: 800 }, pixels: { width: 1000, height: 800 } }), onFailure: vi.fn() }
  openRecordingControl(owner, 'live', backend, options)
  const status = { microphoneLevel: null, cameraPreview: null, warnings: [] }
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
