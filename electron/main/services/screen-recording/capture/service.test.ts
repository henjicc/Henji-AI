import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import type { RecordingControlBackend } from '../control'
import { captureOptionsSchema, type CapturePrepared } from '../../../../../src/core/screenRecording/capture'
import { captureClockCorrelation } from '../../../../../src/core/captureLog/clockSync'

const system = vi.hoisted(() => ({ options: undefined as { directory: string; originUs: number; record(record: unknown): void } | undefined, recorder: { pause: vi.fn(async () => undefined), resume: vi.fn(async () => undefined), stop: vi.fn(async () => ({})) } }))
vi.mock('../../audio-capture/system-audio', () => ({ systemAudioCapture: () => ({ start: async (options: typeof system.options) => { system.options = options; return system.recorder } }) }))
const state = vi.hoisted(() => ({ root: '', backend: null as RecordingControlBackend | null, settled: undefined as (() => Promise<void>) | undefined, ownerLost: undefined as (() => void) | undefined, assert: vi.fn(), grant: vi.fn(), revoke: vi.fn(), failed: vi.fn(), open: vi.fn(), notify: vi.fn(), document: { capture: vi.fn(async () => undefined), range: vi.fn(async () => undefined), pause: vi.fn(async () => undefined), resume: vi.fn(async () => undefined), track: vi.fn(async () => undefined), finish: vi.fn(async () => ({ status: 'stopped', durationUs: 1 })), pageReferences: () => [], ledger: { detaches: 0 } } }))
vi.mock('electron', () => ({ BrowserWindow: { fromWebContents: () => null } }))
vi.mock('../../appPaths', () => ({ getUserFolderDir: () => state.root }))
vi.mock('../../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) }))
vi.mock('node:os', async importOriginal => ({ ...await importOriginal<typeof import('node:os')>(), release: () => '10.0.19045' }))
vi.mock('../../documents/runtime', () => ({ getDocumentService: () => ({ listDocuments: async () => [] }) }))
vi.mock('./gfxcapture', () => ({ GfxCaptureBackend: class { prepare = async (): Promise<void> => undefined; start = async (): Promise<void> => undefined; pause = async (): Promise<void> => undefined; resume = async (): Promise<void> => undefined; stop = async (): Promise<void> => undefined; cancel = async (): Promise<void> => undefined; stats(): object { return { restarts: 0, droppedFrames: 0, duplicatedFrames: 0, encoder: 'cpu' } } } }))
vi.mock('../../media-permissions', () => ({ mediaPermissions: { assertSelection: state.assert, grant: state.grant, sources: async () => [{ id: 'screen:0:0', kind: 'screen', displayId: '1' }] } }))
vi.mock('../runtime', () => ({ recordingControl: { snapshot: () => null, setHostTrackWarning: vi.fn(), captureFailed: async (_id: string, error: Error) => { state.failed(error); await state.backend?.cancel(); state.backend = null } }, openRecordingControl: (_owner: unknown, _id: string, backend: RecordingControlBackend, _events: unknown, settled?: () => Promise<void>, _frame?: unknown, ownerLost?: () => void) => { state.backend = backend; state.settled = settled; state.ownerLost = ownerLost; state.open() }, closeRecordingControl: async () => { await state.backend?.cancel(); state.backend = null }, notifyRecordingProblem: state.notify, recordingEventBacklog: () => 0, minimizeOwnerWhileRecording: vi.fn() }))
vi.mock('./geometry', () => ({ createCaptureGeometry: vi.fn(), createCaptureBounds: vi.fn(() => () => undefined) }))
vi.mock('../session-document', () => ({ RecordingSessionDocument: { create: async () => state.document }, readRecordingEvents: vi.fn(), recoverRecordingSession: vi.fn() }))
vi.mock('./source', () => ({ resolveNativeCaptureSource: vi.fn(async () => ({ selector: 'hmonitor', handle: '100', width: 1920, height: 1080 })) }))
import { handleCaptureRequest } from './service'
const options = captureOptionsSchema.parse({ sourceId: 'screen:0:0', backend: 'chromium', width: 1920, height: 1080, fps: 60, bitrate: 12_000_000 })
const owner = { isDestroyed: () => false, send: vi.fn() } as unknown as WebContents
let id: string
beforeEach(async () => {
  state.root = await fs.mkdtemp(path.join(os.tmpdir(), 'capture-service-')); id = randomUUID(); vi.clearAllMocks()
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
it('Windows 上系统声由主进程录：界面不再采集它；界面断开期间照常录，段记录直接进录制文档；跟着暂停、恢复、停止', async () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  try {
    vi.mocked(owner.send).mockImplementation((_channel, command: { sessionId: string; requestId: string }) => { void handleCaptureRequest(owner, { operation: 'ack', sessionId: command.sessionId, requestId: command.requestId }) })
    const prepared = await handleCaptureRequest(owner, { operation: 'prepare', sessionId: id, options: captureOptionsSchema.parse({ ...options, backend: 'auto' }), session: { name: '课程', tracks: { microphone: {}, systemAudio: true } } }) as CapturePrepared
    expect(prepared.hostTracks).toEqual(['systemAudio'])
    await state.backend!.start(new AbortController().signal)
    expect(system.options).toMatchObject({ directory: path.join(state.root, 'screen-recordings', id), originUs: prepared.originUs })
    state.ownerLost!()
    const record = { type: 'gap', kind: 'systemAudio', gap: { monoSpanUs: [1, 2], reason: 'missing-data' } }
    system.options!.record(record)
    expect(state.document.track).toHaveBeenCalledWith(record)
    await state.backend!.pause(new AbortController().signal)
    await state.backend!.resume(new AbortController().signal)
    await state.backend!.stop(new AbortController().signal)
    expect([system.recorder.pause, system.recorder.resume, system.recorder.stop].map(fn => fn.mock.calls.length)).toEqual([1, 1, 1])
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
