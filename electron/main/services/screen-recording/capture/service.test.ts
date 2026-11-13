import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import type { RecordingControlBackend } from '../control'
import { captureOptionsSchema, type CapturePrepared } from '../../../../../src/core/screenRecording/capture'
import { captureClockCorrelation } from '../../../../../src/core/captureLog/clockSync'

const system = vi.hoisted(() => ({ options: undefined as { directory: string; originUs: number; record(record: unknown): void } | undefined, recorder: { pause: vi.fn(async () => undefined), resume: vi.fn(async () => undefined), stop: vi.fn(async () => ({})), stats: () => ({ reconnects: 0, device: '麦克风', health: {} }) } }))
vi.mock('../../audio-capture/system-audio', () => ({ systemAudioCapture: () => ({ start: async (options: typeof system.options) => { system.options = options; return system.recorder } }) }))
const microphone = vi.hoisted(() => ({ options: undefined as { directory: string; originUs: number; record(record: unknown): void; level?(peak: number): void } | undefined, recorder: { pause: vi.fn(async () => undefined), resume: vi.fn(async () => undefined), stop: vi.fn(async () => ({})), stats: () => ({ reconnects: 0, device: '麦克风', health: {} }) } }))
vi.mock('../../audio-capture/service', () => ({ microphoneCapture: () => ({ startTrack: async (options: typeof microphone.options) => { microphone.options = options; return microphone.recorder } }) }))
const state = vi.hoisted(() => ({ root: '', backend: null as RecordingControlBackend | null, settled: undefined as (() => Promise<void>) | undefined, ownerLost: undefined as (() => void) | undefined, assert: vi.fn(), grant: vi.fn(), revoke: vi.fn(), failed: vi.fn(), open: vi.fn(), notify: vi.fn(), document: { capture: vi.fn(async () => undefined), range: vi.fn(async () => undefined), pause: vi.fn(async () => undefined), resume: vi.fn(async () => undefined), track: vi.fn(async () => undefined), finish: vi.fn(async () => ({ status: 'stopped', durationUs: 1 })), pageReferences: () => [], ledger: { detaches: 0 } } }))
vi.mock('electron', () => ({ BrowserWindow: { fromWebContents: () => null }, screen: { getAllDisplays: () => [{ id: 1, bounds: { x: 1280, y: 0, width: 1280, height: 720 }, scaleFactor: 1.5 }], dipToScreenPoint: (point: { x: number; y: number }) => ({ x: point.x * 1.5, y: point.y * 1.5 }) } }))
const native = vi.hoisted(() => ({ prepare: vi.fn(async (): Promise<void> => undefined), point: undefined as unknown, since: 123 }))
vi.mock('./native-client', () => ({ screenCaptureProcess: () => ({}) }))
vi.mock('./native', () => ({ NativeCaptureBackend: class { constructor(...args: unknown[]) { native.point = args[1] } prepare = native.prepare; start = async (): Promise<void> => undefined; pause = async (): Promise<void> => undefined; resume = async (): Promise<void> => undefined; stop = async (): Promise<void> => undefined; cancel = async (): Promise<void> => undefined; pressed(): void {} capturingSinceUs(): number { return native.since } stats(): object { return { restarts: 0, droppedFrames: 0, duplicatedFrames: 0, encoder: 'h264_nvenc' } } } }))
vi.mock('../../appPaths', () => ({ getUserFolderDir: () => state.root }))
vi.mock('../../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) }))
vi.mock('node:os', async importOriginal => ({ ...await importOriginal<typeof import('node:os')>(), release: () => '10.0.19045' }))
vi.mock('../../documents/runtime', () => ({ getDocumentService: () => ({ listDocuments: async () => [] }) }))
const gfx = vi.hoisted(() => ({ deps: undefined as { failed(error: Error): void; sourceEnded?(): void; sourceAvailable?(): boolean } | undefined, present: vi.fn(() => true) }))
vi.mock('./gfxcapture', () => ({ GfxCaptureBackend: class { constructor(...args: unknown[]) { gfx.deps = args[3] as typeof gfx.deps } prepare = async (): Promise<void> => undefined; start = async (): Promise<void> => undefined; pause = async (): Promise<void> => undefined; resume = async (): Promise<void> => undefined; stop = async (): Promise<void> => undefined; cancel = async (): Promise<void> => undefined; stats(): object { return { restarts: 0, droppedFrames: 0, duplicatedFrames: 0, encoder: 'cpu' } } } }))
vi.mock('../../media-permissions', () => ({ mediaPermissions: { assertSelection: state.assert, grant: state.grant, requestAccess: async () => undefined, sources: async () => [{ id: 'screen:0:0', kind: 'screen', displayId: '1' }] } }))
vi.mock('../runtime', () => ({ recordingControl: { snapshot: () => null, setHostTrackWarning: vi.fn(), setMicrophoneLevel: vi.fn(), captureFailed: async (_id: string, error: Error) => { state.failed(error); await state.backend?.cancel(); state.backend = null },
  // 与真实的控制一样：来源没了就走停止，停止后收尾。
  sourceEnded: vi.fn((): boolean => { void (async () => { await state.backend!.ending?.(); await state.backend!.stop(new AbortController().signal); await state.settled?.() })(); return true }) }, openRecordingControl: (_owner: unknown, _id: string, backend: RecordingControlBackend, _events: unknown, settled?: () => Promise<void>, _frame?: unknown, ownerLost?: () => void) => { state.backend = backend; state.settled = settled; state.ownerLost = ownerLost; state.open() }, closeRecordingControl: async () => { await state.backend?.cancel(); state.backend = null }, notifyRecordingProblem: state.notify, recordingEventBacklog: () => 0, minimizeOwnerWhileRecording: vi.fn() }))
vi.mock('./geometry', () => ({ createCaptureGeometry: vi.fn(), createCaptureBounds: vi.fn(() => () => undefined), createCaptureSourcePresence: () => ({ misses: 3, present: () => gfx.present() }), captureSourceGone: async () => !gfx.present(), CAPTURE_PRESENCE_INTERVAL_MS: 20 }))
vi.mock('../session-document', () => ({ RecordingSessionDocument: { create: async () => state.document }, readRecordingEvents: vi.fn(), recoverRecordingSession: vi.fn() }))
vi.mock('./source', () => ({ resolveNativeCaptureSource: vi.fn(async () => ({ selector: 'hmonitor', handle: '100', width: 1920, height: 1080 })) }))
import { handleCaptureRequest } from './service'
const options = captureOptionsSchema.parse({ sourceId: 'screen:0:0', backend: 'chromium', width: 1920, height: 1080, fps: 60, bitrate: 12_000_000 })
const owner = { isDestroyed: () => false, send: vi.fn() } as unknown as WebContents
let id: string
beforeEach(async () => {
  state.root = await fs.mkdtemp(path.join(os.tmpdir(), 'capture-service-')); id = randomUUID(); vi.clearAllMocks(); gfx.present.mockImplementation(() => true)
  vi.mocked(owner.send).mockImplementation((_channel, command: { operation: string; sessionId: string; requestId: string }) => {
    if (command.operation === 'cancel') void handleCaptureRequest(owner, { operation: 'ack', sessionId: command.sessionId, requestId: command.requestId })
  })
})
afterEach(async () => { if (state.backend) await handleCaptureRequest(owner, { operation: 'close', sessionId: id }); await fs.rm(state.root, { recursive: true, force: true }) })
it('requires a live selected-source grant before creating any capture files or control', async () => {
  state.assert.mockImplementationOnce(() => { throw new Error('权限拒绝') })
  await expect(handleCaptureRequest(owner, { operation: 'prepare', sessionId: id, options })).rejects.toThrow('权限拒绝')
  expect(await fs.readdir(state.root)).toEqual([]); expect(state.open).not.toHaveBeenCalled()
})
it('isolates renderer writes and acknowledgements by exact owner/session, and close permits a new capture', async () => {
  await handleCaptureRequest(owner, { operation: 'prepare', sessionId: id, options })
  const span = await handleCaptureRequest(owner, { operation: 'open-span', sessionId: id }) as { index: number }
  await expect(handleCaptureRequest({} as WebContents, { operation: 'write', sessionId: id, index: span.index, position: 0, data: new Uint8Array([1]) })).rejects.toThrow('不属于')
  await expect(handleCaptureRequest(owner, { operation: 'read', sessionId: randomUUID() })).rejects.toThrow('不属于')
  await expect(handleCaptureRequest(owner, { operation: 'recover', sessionId: id })).rejects.toThrow('先关闭')
  await handleCaptureRequest(owner, { operation: 'write', sessionId: id, index: span.index, position: 0, data: new Uint8Array([1, 2]) })
  await handleCaptureRequest(owner, { operation: 'seal-span', sessionId: id, index: span.index, durationUs: 30_000 })
  expect(await handleCaptureRequest(owner, { operation: 'read', sessionId: id })).toMatchObject({ spans: [{ finalized: true, durationUs: 30_000 }] })
  await handleCaptureRequest(owner, { operation: 'close', sessionId: id })
  id = randomUUID()
  await handleCaptureRequest(owner, { operation: 'prepare', sessionId: id, options })
  expect(state.open).toHaveBeenCalledTimes(2)
})
it('waits for matching renderer completion before changing recording state', async () => {
  await handleCaptureRequest(owner, { operation: 'prepare', sessionId: id, options })
  const start = state.backend!.start(new AbortController().signal)
  await vi.waitFor(() => expect(owner.send).toHaveBeenCalledWith('screenRecording:captureCommand', expect.objectContaining({ operation: 'start' })))
  const command = vi.mocked(owner.send).mock.calls.at(-1)![1] as { requestId: string }
  expect(await handleCaptureRequest(owner, { operation: 'read', sessionId: id })).toMatchObject({ status: 'prepared' })
  await handleCaptureRequest(owner, { operation: 'ack', sessionId: id, requestId: command.requestId })
  await start
  expect(await handleCaptureRequest(owner, { operation: 'read', sessionId: id })).toMatchObject({ status: 'recording' })
})
it('exposes the screen epoch for shared event and audio/camera clocks without rebasing after pause', async () => {
  const prepared = await handleCaptureRequest(owner, { operation: 'prepare', sessionId: id, options }) as CapturePrepared
  expect(Number.isSafeInteger(prepared.originUs)).toBe(true)
  expect(prepared.originUs).toBeGreaterThan(0)
  const before = Number(process.hrtime.bigint() / 1000n)
  const screenUs = await handleCaptureRequest(owner, { operation: 'clock', sessionId: id }) as number
  const after = Number(process.hrtime.bigint() / 1000n)
  expect(screenUs).toBeGreaterThanOrEqual(before - prepared.originUs)
  expect(screenUs).toBeLessThanOrEqual(after - prepared.originUs)
  const correlation = captureClockCorrelation({ beforeMs: 100, afterMs: 100, mainUs: prepared.originUs + screenUs }, prepared.originUs)
  expect(Math.round((100 - correlation.originMs) * 1000)).toBe(screenUs)
  const pause = state.backend!.pause(new AbortController().signal)
  await vi.waitFor(() => expect(owner.send).toHaveBeenCalledWith('screenRecording:captureCommand', expect.objectContaining({ operation: 'pause' })))
  const command = vi.mocked(owner.send).mock.calls.at(-1)![1] as { requestId: string }
  await handleCaptureRequest(owner, { operation: 'ack', sessionId: id, requestId: command.requestId })
  await pause
  const resumedUs = await handleCaptureRequest(owner, { operation: 'clock', sessionId: id }) as number
  expect(resumedUs).toBeGreaterThanOrEqual(screenUs)
})
it('rechecks the selected-source grant at actual start after the countdown', async () => {
  await handleCaptureRequest(owner, { operation: 'prepare', sessionId: id, options })
  state.assert.mockImplementationOnce(() => { throw new Error('权限已撤销') })
  await expect(state.backend!.start(new AbortController().signal)).rejects.toThrow('权限已撤销')
  expect(JSON.parse(await fs.readFile(path.join(state.root, 'screen-recordings', id, 'capture.json'), 'utf8'))).toMatchObject({ status: 'failed' })
  expect(state.failed).toHaveBeenCalledWith(expect.objectContaining({ message: '权限已撤销' }))
  expect(vi.mocked(owner.send).mock.calls.some(call => (call[1] as { operation: string }).operation === 'start')).toBe(false)
})
it('麦克风与 Windows 的系统声由主进程录：界面不再采集它们；界面断开期间照常录，段记录直接进录制文档，两路同一个原点；跟着暂停、恢复、停止', async () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  try {
    vi.mocked(owner.send).mockImplementation((_channel, command: { sessionId: string; requestId: string }) => { void handleCaptureRequest(owner, { operation: 'ack', sessionId: command.sessionId, requestId: command.requestId }) })
    const prepared = await handleCaptureRequest(owner, { operation: 'prepare', sessionId: id, options: captureOptionsSchema.parse({ ...options, backend: 'auto' }), session: { name: '课程', tracks: { microphone: {}, systemAudio: true } } }) as CapturePrepared
    expect(prepared.hostTracks).toEqual(['microphone', 'systemAudio'])
    await state.backend!.start(new AbortController().signal)
    const directory = path.join(state.root, 'screen-recordings', id)
    expect(system.options).toMatchObject({ directory, originUs: prepared.originUs })
    expect(microphone.options).toMatchObject({ directory, originUs: prepared.originUs })
    state.ownerLost!()
    const record = { type: 'gap', kind: 'microphone', gap: { monoSpanUs: [1, 2], reason: 'device' } }
    microphone.options!.record(record)
    expect(state.document.track).toHaveBeenCalledWith(record)
    await state.backend!.pause(new AbortController().signal)
    await state.backend!.resume(new AbortController().signal)
    await state.backend!.stop(new AbortController().signal)
    for (const recorder of [system.recorder, microphone.recorder]) expect([recorder.pause, recorder.resume, recorder.stop].map(fn => fn.mock.calls.length)).toEqual([1, 1, 1])
  } finally { Object.defineProperty(process, 'platform', platform) }
})
it('界面重载期间画面照常录、不再向断开的界面发命令；同一宿主接回后重新登记授权并交还接续信息，停止时一次收尾', async () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  try {
    vi.mocked(owner.send).mockImplementation((_channel, command: { sessionId: string; requestId: string }) => { void handleCaptureRequest(owner, { operation: 'ack', sessionId: command.sessionId, requestId: command.requestId }) })
    const native = captureOptionsSchema.parse({ ...options, backend: 'auto' })
    await handleCaptureRequest(owner, { operation: 'prepare', sessionId: id, options: native, session: { name: '课程', tracks: { microphone: {}, systemAudio: false } }, followUp: { handoff: true } })
    state.ownerLost!()
    expect(state.document.track).toHaveBeenCalledWith(expect.objectContaining({ type: 'detach' }))
    state.assert.mockClear()
    await state.backend!.start(new AbortController().signal)
    expect(vi.mocked(owner.send)).not.toHaveBeenCalled()
    expect(state.assert).not.toHaveBeenCalled()
    const attached = await handleCaptureRequest(owner, { operation: 'attach', sessionId: id }) as { prepared: CapturePrepared; followUp: unknown }
    expect(state.grant).toHaveBeenCalledWith(owner, id, ['screen', 'microphone'], { sourceId: 'screen:0:0', excludedSourceIds: [] })
    expect(attached).toMatchObject({ prepared: { sessionId: id, backend: 'gfxcapture' }, followUp: { handoff: true } })
    await state.backend!.stop(new AbortController().signal)
    expect(vi.mocked(owner.send)).toHaveBeenCalledWith('screenRecording:captureCommand', expect.objectContaining({ operation: 'stop' }))
    await state.settled!()
    expect(state.document.finish).toHaveBeenCalledOnce()
    expect(state.notify).not.toHaveBeenCalled()
  } finally { Object.defineProperty(process, 'platform', platform) }
})
async function prepareNative(): Promise<void> {
  vi.mocked(owner.send).mockImplementation((_channel, command: { sessionId: string; requestId: string }) => { void handleCaptureRequest(owner, { operation: 'ack', sessionId: command.sessionId, requestId: command.requestId }) })
  await handleCaptureRequest(owner, { operation: 'prepare', sessionId: id, options: captureOptionsSchema.parse({ ...options, backend: 'auto' }), session: { name: '课程', tracks: { microphone: {}, systemAudio: false } } })
  await state.backend!.start(new AbortController().signal)
}
async function withWindows(work: () => Promise<void>): Promise<void> {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  try { await work() } finally { Object.defineProperty(process, 'platform', platform) }
}
const manifestStatus = async (): Promise<string> => JSON.parse(await fs.readFile(path.join(state.root, 'screen-recordings', id, 'capture.json'), 'utf8')).status
it('被录的来源没了（编码进程报来源结束）：按停止收尾为已停止、不算失败，读回写明原因；释放后马上能开始新的录制', () => withWindows(async () => {
  const { recordingControl } = await import('../runtime')
  await prepareNative()
  gfx.deps!.sourceEnded!()
  await vi.waitFor(() => expect(state.document.finish).toHaveBeenCalledOnce())
  expect(recordingControl.sourceEnded).toHaveBeenCalledWith(id, 'display')
  expect(await manifestStatus()).toBe('stopped')
  expect(state.failed).not.toHaveBeenCalled()
  expect(microphone.recorder.stop).toHaveBeenCalledOnce()
  // 停止后编码进程又报一次（或巡检再发现一次）不重复收尾。
  gfx.deps!.sourceEnded!(); expect(recordingControl.sourceEnded).toHaveBeenCalledOnce()
  await handleCaptureRequest(owner, { operation: 'close', sessionId: id })
  expect(await handleCaptureRequest(owner, { operation: 'facts', sessionId: id })).toMatchObject({ failure: null, sourceEnded: '被录制的显示器已断开' })
  id = randomUUID()
  await expect(handleCaptureRequest(owner, { operation: 'prepare', sessionId: id, options })).resolves.toMatchObject({ sessionId: id })
}))
it('来源巡检：暂停中显示器连续几次都查不到才按停止收尾（编码进程不报时兜底）', () => withWindows(async () => {
  const { recordingControl } = await import('../runtime')
  await prepareNative()
  await state.backend!.pause(new AbortController().signal)
  gfx.present.mockImplementation(() => false)
  await vi.waitFor(() => expect(state.document.finish).toHaveBeenCalledOnce(), { timeout: 3000 })
  expect(recordingControl.sourceEnded).toHaveBeenCalledWith(id, 'display')
  expect(await manifestStatus()).toBe('stopped')
}))
it('采集出错（如续录达到上限）：已录部分收尾保存为中断；释放只做一次，之后关控制条不再对着已结束的会话等回执', () => withWindows(async () => {
  await prepareNative()
  const backend = state.backend!
  gfx.deps!.failed(new Error('一分钟内多次续录都没能恢复'))
  await vi.waitFor(() => expect(state.failed).toHaveBeenCalledOnce())
  await backend.cancel() // 等采集失败时那次释放做完。
  await state.settled!()
  expect(state.document.finish).toHaveBeenCalledOnce()
  expect(await manifestStatus()).toBe('failed')
  expect(state.notify).toHaveBeenCalledWith(owner, expect.stringContaining('已保存'))
  const cancels = (): number => vi.mocked(owner.send).mock.calls.filter(call => (call[1] as { operation: string }).operation === 'cancel').length
  expect(cancels()).toBe(1)
  const acks = vi.mocked(owner.send).getMockImplementation()
  vi.mocked(owner.send).mockImplementation(() => undefined) // 会话已结束：界面的回执不会再被受理。
  const started = Date.now()
  await backend.cancel()
  expect(Date.now() - started).toBeLessThan(1000); expect(cancels()).toBe(1)
  vi.mocked(owner.send).mockImplementation(acks!)
  id = randomUUID()
  await expect(handleCaptureRequest(owner, { operation: 'prepare', sessionId: id, options })).resolves.toMatchObject({ sessionId: id })
}))
it('显示器短暂从枚举里消失（休眠、KVM、改投影）不结束录制；用户已在停止时来源才没了不记原因', () => withWindows(async () => {
  const { recordingControl } = await import('../runtime')
  await prepareNative()
  let calls = 0
  gfx.present.mockImplementation(() => ++calls % 3 !== 0) // 每三次巡检有一次查不到，从不连续。
  await new Promise(resolve => setTimeout(resolve, 300))
  expect(calls).toBeGreaterThan(5); expect(recordingControl.sourceEnded).not.toHaveBeenCalled()
  vi.mocked(recordingControl.sourceEnded).mockImplementationOnce(() => false) // 控制已在停止中，不接手。
  gfx.present.mockImplementation(() => false)
  await vi.waitFor(() => expect(recordingControl.sourceEnded).toHaveBeenCalledOnce())
  await state.backend!.stop(new AbortController().signal); await state.settled!()
  await handleCaptureRequest(owner, { operation: 'close', sessionId: id })
  expect(await handleCaptureRequest(owner, { operation: 'facts', sessionId: id })).not.toHaveProperty('sourceEnded')
}))

it('开发开关打开时整屏录制先试原生画面采集（按物理像素找显示器）；原生不支持就照现有录法录，不报错', async () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  process.env.HENJI_NATIVE_SCREEN_CAPTURE = '1'
  try {
    const full = captureOptionsSchema.parse({ ...options, backend: 'auto' })
    native.prepare.mockRejectedValueOnce(Object.assign(new Error('没有 NVIDIA 显卡'), { code: 'ENCODER_UNSUPPORTED' }))
    gfx.deps = undefined
    await expect(handleCaptureRequest(owner, { operation: 'prepare', sessionId: id, options: full })).resolves.toMatchObject({ backend: 'gfxcapture' })
    // 副屏在 DIP 的 1280 起、缩放 150%：中心的物理坐标是 (2880, 540)。
    expect(native.point).toEqual([2880, 540])
    expect(gfx.deps).toBeDefined()
    await handleCaptureRequest(owner, { operation: 'close', sessionId: id })

    id = randomUUID(); gfx.deps = undefined
    await handleCaptureRequest(owner, { operation: 'prepare', sessionId: id, options: full })
    expect(gfx.deps).toBeUndefined()
    expect(state.backend!.capturingSinceUs!()).toBe(native.since)

    // 录制尺寸与显示器原尺寸不同（原生不缩放）：不试原生。
    await handleCaptureRequest(owner, { operation: 'close', sessionId: id })
    id = randomUUID(); native.prepare.mockClear()
    await handleCaptureRequest(owner, { operation: 'prepare', sessionId: id, options: captureOptionsSchema.parse({ ...full, width: 1280, height: 720 }) })
    expect(native.prepare).not.toHaveBeenCalled()
  } finally { Object.defineProperty(process, 'platform', platform); delete process.env.HENJI_NATIVE_SCREEN_CAPTURE }
})
