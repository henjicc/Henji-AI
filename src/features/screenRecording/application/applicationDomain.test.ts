import { expect, it, vi } from 'vitest'
import type { CapabilityHandler } from '@/features/application-control/capabilities/handlerTypes'
import type { RecordingControlSnapshot } from '@/core/screenRecording/contracts'
import type { RecordingDocument } from '@/core/screenRecording/document'
import { createRecordingDocument } from '@/core/screenRecording/document'
import { DEFAULT_RECORDING_SETUP, recordingOutput, recordingTracksFromSetup, type RecordingSetup } from '../recordingSetupModel'
import { RECORDING_CAPABILITIES } from '@/core/application-control/domains/screenRecording/recordingCapabilities'

const state = vi.hoisted(() => ({ content: undefined as RecordingDocument | undefined, snapshot: null as RecordingControlSnapshot | null, changed: undefined as ((snapshot: RecordingControlSnapshot | null) => void) | undefined, grant: vi.fn(), revoke: vi.fn(), events: vi.fn(async (): Promise<unknown> => null), prepared: vi.fn(), saved: undefined as RecordingSetup | undefined, audioEditRecording: false }))
vi.mock('@/platform', () => ({ getPlatform: () => ({
  audioCapture: { recordingState: async () => ({ recording: state.audioEditRecording ? { outputPath: 'take.wav', state: 'recording', durationSeconds: 1, health: null } : null, sharedMicrophone: false, interruption: null, pending: [], settingsRevision: 0 }) },
  documents: { readDocument: async () => ({ meta: { id: state.content!.sessionId, kind: 'screen_recording', name: '课程', revision: 1 }, content: structuredClone(state.content) }) },
  screenRecording: { grant: state.grant, revoke: state.revoke, snapshot: async () => state.snapshot, onChanged: (handler: typeof state.changed) => { state.changed = handler; return () => { state.changed = undefined } }, capture: state.events,
    control: async (_id: string, command: string) => {
      state.snapshot = { ...state.snapshot!, phase: command === 'stop' ? 'stopped' : 'recording' }
      if (command === 'stop') state.content!.status = 'stopped'
      state.changed?.(state.snapshot)
    },
  },
}) }))
// Only the process/device boundary is replaced; capability parsing, domain handler, lifecycle and readback stay real.
vi.mock('../capture/session', () => ({ prepareScreenCapture: async (id: string, ...rest: unknown[]) => {
  state.prepared(id, ...rest)
  state.content = { ...createRecordingDocument(), sessionId: id, status: 'prepared' }
  state.snapshot = { sessionId: id, phase: 'ready', elapsedMs: 0, busy: false } as RecordingControlSnapshot
  return { close: async () => { state.snapshot = null; state.changed?.(null) } }
} }))
vi.mock('@/features/documents/documentOperations', () => ({ registerDocumentOpener: vi.fn(), registerDocumentBusyCheck: vi.fn() }))
vi.mock('@/features/documents/documentCovers', () => ({ registerDocumentCoverProvider: vi.fn() }))
vi.mock('@/features/documents/documentOperationChanges', () => ({ defaultDocumentOperationChanges: { changed: vi.fn() }, markSessionDocumentOpened: vi.fn() }))
vi.mock('@/features/navigation/application/surfaceCapabilityService', () => ({ openApplicationSurface: vi.fn() }))
vi.mock('./recordingVideoImport', () => ({ importRecordingToVideo: vi.fn() }))
vi.mock('../tracks/devices', () => ({ recordingDevices: async () => [] }))
// 录屏设置存在界面本地存储里；这里只替换读取那一处，换算成分辨率、编码与轨道仍走正式实现。
vi.mock('../recordingSetupModel', async original => {
  const actual = await original<typeof import('../recordingSetupModel')>()
  return { ...actual, loadRecordingSetup: () => ({ range: 'screen', sourceId: '', region: { x: 0, y: 0, width: 1, height: 1 }, setup: state.saved ?? actual.DEFAULT_RECORDING_SETUP }) }
})
import { screenRecordingApplicationDomain } from './applicationDomain'
import { recordingView } from './recordingService'

it('根据公开名称与 schema 开始、停止并经同一会话服务读回；停止事件与显式停止不会重复收尾', async () => {
  const handlers = new Map<string, CapabilityHandler>()
  screenRecordingApplicationDomain.registerCapabilities({ registerHandler: (id, handler) => { handlers.set(id, handler) } })
  const invoke = async (id: string, input: unknown) => {
    const capability = RECORDING_CAPABILITIES.find(item => item.id === id)!
    const result = await handlers.get(id)!(capability.inputSchema.parse(input), { signal: new AbortController().signal })
    expect(capability.outputSchema.safeParse({ ...result, revision: 0, scopeRevisions: {} }).success).toBe(true)
    return result
  }
  const started = await invoke('start_screen_recording', { name: '课程', sourceRef: { kind: 'screen_recording.source', id: 'screen:1:0' }, tracks: { microphone: {}, systemAudio: false } })
  expect(started).toMatchObject({ verified: true, resultRef: { kind: 'screen_recording.session' } })
  expect(state.grant).toHaveBeenCalledWith(expect.objectContaining({ kinds: ['screen', 'microphone'] }))
  const sessionRef = started.resultRef as { kind: string; id: string }
  const provider = screenRecordingApplicationDomain.entities().find(item => item.entity.id === 'screen_recording.session')!.provider!
  expect(await provider.readEntity(sessionRef, {})).toMatchObject({ properties: { 'screen_recording.session.phase': 'recording' } })
  await invoke('stop_screen_recording', { sessionRef })
  expect(recordingView()).toMatchObject({ snapshot: null, busy: false, content: { status: 'stopped' } })
  expect(await provider.readEntity(sessionRef, {})).toMatchObject({ properties: { 'screen_recording.session.phase': 'stopped' } })
  state.events.mockResolvedValue({ events: [], nextOffset: null })
  expect(await invoke('read_screen_recording_events', { sessionRef, limit: 1 })).toEqual({ events: [], nextOffset: null })
  expect(state.events).toHaveBeenCalledWith({ operation: 'events', sessionId: sessionRef.id, offset: 0, limit: 1, markersOnly: false })
})

it('不传分辨率、帧率与声音时跟随录屏设置里保存的值，与录屏页开始录制得到的一样', async () => {
  state.saved = { ...DEFAULT_RECORDING_SETUP, quality: '2160p', fps: 60, microphone: true, systemAudio: true, camera: false }
  state.prepared.mockClear(); state.grant.mockClear()
  const handlers = new Map<string, CapabilityHandler>()
  screenRecordingApplicationDomain.registerCapabilities({ registerHandler: (id, handler) => { handlers.set(id, handler) } })
  const capability = RECORDING_CAPABILITIES.find(item => item.id === 'start_screen_recording')!
  const started = await handlers.get('start_screen_recording')!(capability.inputSchema.parse({ name: '长录', sourceRef: { kind: 'screen_recording.source', id: 'screen:1:0' } }), { signal: new AbortController().signal })
  const [, options, session] = state.prepared.mock.calls[0] as [string, Record<string, unknown>, { tracks: unknown }]
  // 录屏页“开始录制”用的就是这两个换算
  expect(options).toMatchObject({ ...recordingOutput(state.saved), sourceId: 'screen:1:0' })
  expect(options).toMatchObject({ width: 3840, height: 2160, fps: 60 })
  expect(session.tracks).toEqual(recordingTracksFromSetup(state.saved))
  expect(state.grant).toHaveBeenCalledWith(expect.objectContaining({ kinds: ['screen', 'microphone', 'systemAudio'] }))
  await handlers.get('stop_screen_recording')!({ sessionRef: started.resultRef }, { signal: new AbortController().signal })
})

it('音频编辑正在录音时省略 tracks 不带麦克风并如实说明；显式要麦克风在写入前拒绝；快速模式与界面一样不录摄像头', async () => {
  state.saved = { ...DEFAULT_RECORDING_SETUP, mode: 'quick', microphone: true, systemAudio: false, camera: true }
  state.audioEditRecording = true
  state.prepared.mockClear()
  const handlers = new Map<string, CapabilityHandler>()
  screenRecordingApplicationDomain.registerCapabilities({ registerHandler: (id, handler) => { handlers.set(id, handler) } })
  const start = RECORDING_CAPABILITIES.find(item => item.id === 'start_screen_recording')!
  const signal = new AbortController().signal
  try {
    const refused = await Promise.resolve().then(() => handlers.get('start_screen_recording')!(start.inputSchema.parse({ name: '课', sourceRef: { kind: 'screen_recording.source', id: 'screen:1:0' }, tracks: { microphone: {}, systemAudio: false } }), { signal })).catch((error: unknown) => error)
    expect(refused).toMatchObject({ message: expect.stringContaining('音频编辑正在录音'), details: { execution: { notExecuted: true } } })
    expect(state.prepared).not.toHaveBeenCalled()
    const started = await handlers.get('start_screen_recording')!(start.inputSchema.parse({ name: '课', sourceRef: { kind: 'screen_recording.source', id: 'screen:1:0' } }), { signal })
    expect(started.message).toContain('没有开麦克风')
    expect((state.prepared.mock.calls[0] as [string, unknown, { tracks: unknown }])[2].tracks).toEqual({ systemAudio: false })
    await handlers.get('stop_screen_recording')!({ sessionRef: started.resultRef }, { signal })
  } finally { state.audioEditRecording = false }
})
