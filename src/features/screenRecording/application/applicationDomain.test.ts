import { expect, it, vi } from 'vitest'
import type { CapabilityHandler } from '@/features/application-control/capabilities/handlerTypes'
import type { RecordingControlSnapshot } from '@/core/screenRecording/contracts'
import type { RecordingDocument } from '@/core/screenRecording/document'
import { createRecordingDocument } from '@/core/screenRecording/document'
import { DEFAULT_RECORDING_SETUP, recordingOutput, recordingTracksFromSetup, type RecordingSetup } from '../recordingSetupModel'
import { RECORDING_CAPABILITIES } from '@/core/application-control/domains/screenRecording/recordingCapabilities'

const state = vi.hoisted(() => ({ content: undefined as RecordingDocument | undefined, snapshot: null as RecordingControlSnapshot | null, changed: undefined as ((snapshot: RecordingControlSnapshot | null) => void) | undefined, grant: vi.fn(), revoke: vi.fn(), events: vi.fn(async (): Promise<unknown> => null), prepared: vi.fn(), saved: undefined as RecordingSetup | undefined, audioEditRecording: false, files: new Set<string>() }))
vi.mock('@/platform', () => ({ getPlatform: () => ({
  system: { fs: { exists: async (file: string) => state.files.has(file) } },
  audioCapture: { recordingState: async () => ({ recording: state.audioEditRecording ? { outputPath: 'take.wav', state: 'recording', durationSeconds: 1, health: null } : null, sharedMicrophone: false, interruption: null, pending: [], settingsRevision: 0 }) },
  documents: { readDocument: async () => ({ meta: { id: state.content!.sessionId, kind: 'screen_recording', name: '课程', revision: 1 }, content: structuredClone(state.content) }) },
  screenRecording: { sources: async () => [{ id: 'screen:2:0', name: '屏幕 2', kind: 'screen', displayId: '2', display: { x: 2560, y: 0, width: 1920, height: 1080, scaleFactor: 2, primary: false } }], grant: state.grant, revoke: state.revoke, snapshot: async () => state.snapshot, onChanged: (handler: typeof state.changed) => { state.changed = handler; return () => { state.changed = undefined } }, capture: state.events,
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
vi.mock('./recordingVideoImport', () => ({ importRecordingToVideo: vi.fn(), openRecordingInEditor: vi.fn() }))
vi.mock('../tracks/devices', () => ({ recordingDevices: async () => [] }))
// 目标剪辑只替换打开实例这一处：序列与素材名照常从文档读。
const edit = vi.hoisted(() => ({ document: { id: 'edit', sequences: [{ id: 'seq', name: '主序列' }], items: [{ id: 'item-1', name: '课程 · 屏幕' }] }, session: { documentMeta: { container: { kind: 'project', projectId: 'p' } } } }))
vi.mock('@/features/videoEdit', async original => ({ ...await original<object>(), openVideoEditDocument: async () => edit, holdVideoEditActivity: () => () => undefined }))
// 录屏设置存在界面本地存储里；这里只替换读取那一处，换算成分辨率、编码与轨道仍走正式实现。
vi.mock('../recordingSetupModel', async original => {
  const actual = await original<typeof import('../recordingSetupModel')>()
  return { ...actual, loadRecordingSetup: () => ({ range: 'screen', sourceId: '', region: { x: 0, y: 0, width: 1, height: 1 }, setup: state.saved ?? actual.DEFAULT_RECORDING_SETUP }) }
})
import { screenRecordingApplicationDomain } from './applicationDomain'
import { recordingView, startRecording } from './recordingService'
import { importRecordingToVideo, openRecordingInEditor } from './recordingVideoImport'

it('用户在录屏页开始、助手停止的录制：回执说明素材已按录屏页送进剪辑，不提示再导入', async () => {
  const handlers = new Map<string, CapabilityHandler>()
  screenRecordingApplicationDomain.registerCapabilities({ registerHandler: (id, handler) => { handlers.set(id, handler) } })
  // 与录屏页“开始录制”同一入口：handoff=true，停止后由录屏服务自己送进剪辑。
  const id = await startRecording({ sourceId: 'screen:1:0', width: 1920, height: 1080, fps: 30 } as Parameters<typeof startRecording>[0], { name: '课程', tracks: { systemAudio: false } }, null, undefined, undefined, true)
  Object.assign(state.content!, { startUs: 0, endUs: 2_000_000, media: [{ id: 'screen', kind: 'screen', path: '/s.mp4', monoUs: 0, durationUs: 2_000_000 }] })
  vi.mocked(openRecordingInEditor).mockResolvedValueOnce({ documentId: 'edit', sequenceId: 'seq', frame: 0, imported: { itemIds: ['item-1'], combined: true, screens: 1 } })
  const stopped = await handlers.get('stop_screen_recording')!({ sessionRef: { kind: 'screen_recording.session', id } }, { signal: new AbortController().signal })
  expect(openRecordingInEditor).toHaveBeenCalledWith(id, null)
  expect(importRecordingToVideo).not.toHaveBeenCalled()
  expect(stopped).toMatchObject({ imported: { documentRef: { id: 'edit' }, itemRefs: [{ id: 'edit:item-1' }] } })
  expect(stopped.message).toContain('课程 · 屏幕'); expect(stopped.message).not.toContain('import_screen_recording')
})

it('屏幕来源读得出实际像素分辨率、是否主屏与桌面位置，分得清是哪块屏', async () => {
  const provider = screenRecordingApplicationDomain.entities().find(item => item.entity.id === 'screen_recording.source')!.provider!
  const read = await provider.readEntity({ kind: 'screen_recording.source', id: 'screen:2:0' }, {})
  expect(read.properties['screen_recording.source.details']).toEqual({ sourceKind: 'screen', display: { x: 2560, y: 0, width: 1920, height: 1080, scaleFactor: 2, primary: false, pixelWidth: 3840, pixelHeight: 2160 } })
})

it('目标序列认读回的“文档:序列”与裸 id；不在这份剪辑里的序列在执行前就以参数错误拒绝并列出可用序列', async () => {
  state.saved = undefined; state.prepared.mockClear()
  const handlers = new Map<string, CapabilityHandler>()
  screenRecordingApplicationDomain.registerCapabilities({ registerHandler: (id, handler) => { handlers.set(id, handler) } })
  const start = RECORDING_CAPABILITIES.find(item => item.id === 'start_screen_recording')!
  const signal = new AbortController().signal
  const input = (sequenceId: string) => start.inputSchema.parse({ name: '课程', sourceRef: { kind: 'screen_recording.source', id: 'screen:1:0' }, tracks: { systemAudio: false }, destination: { documentId: 'edit', sequenceId } })
  await expect(handlers.get('start_screen_recording')!(input('edit:gone'), { signal })).rejects.toMatchObject({ message: expect.stringContaining('edit:seq（主序列）'), details: { execution: { notExecuted: true } } })
  expect(state.prepared).not.toHaveBeenCalled()
  const importInput = { sessionRef: { kind: 'screen_recording.session', id: '00000000-0000-4000-8000-000000000009' }, destination: { documentId: 'edit', sequenceId: 'other:seq' } }
  await expect(handlers.get('import_screen_recording')!(importInput, { signal })).rejects.toMatchObject({ details: { execution: { notExecuted: true } } })
  expect(importRecordingToVideo).not.toHaveBeenCalled()
  // 编码器中途重启分成两组：回执如实说两个画面素材，不说“一个”。
  vi.mocked(importRecordingToVideo).mockResolvedValueOnce({ itemIds: ['a', 'b', 'c'], combined: true, screens: 2 })
  const imported = await handlers.get('import_screen_recording')!({ ...importInput, destination: { documentId: 'edit', sequenceId: 'edit:seq' } }, { signal }) as { message: string }
  expect(imported.message).toContain('分成 2 个素材'); expect(imported.message).not.toContain('一组')
  const started = await handlers.get('start_screen_recording')!(input('edit:seq'), { signal })
  expect((state.prepared.mock.calls[0] as unknown[])[4]).toMatchObject({ destination: { documentId: 'edit', sequenceId: 'seq' } })
  // 录制中计数还没封存：不给假的 0；已录时长不含暂停，停止后同一口径。
  state.snapshot = { ...state.snapshot!, elapsedMs: 6000 }
  const provider = screenRecordingApplicationDomain.entities().find(item => item.entity.id === 'screen_recording.session')!.provider!
  const live = await provider.readEntity(started.resultRef as { kind: string; id: string }, {})
  expect(live.properties['screen_recording.session.elapsed_ms']).toBe(6000)
  expect(live.properties['screen_recording.session.details']).not.toHaveProperty('events')
  Object.assign(state.content!, { startUs: 0, endUs: 8_000_000, pauses: [{ startUs: 2_000_000, endUs: 4_000_000 }], media: [{ id: 'screen', kind: 'screen', path: '/s.mp4', monoUs: 0, durationUs: 8_000_000 }] })
  vi.mocked(importRecordingToVideo).mockResolvedValueOnce({ itemIds: ['item-1'], combined: true, screens: 1 })
  const stopped = await handlers.get('stop_screen_recording')!({ sessionRef: started.resultRef }, { signal })
  expect(importRecordingToVideo).toHaveBeenCalledWith(expect.any(String), { documentId: 'edit', sequenceId: 'seq' })
  expect(stopped).toMatchObject({ message: expect.stringContaining('课程 · 屏幕'), imported: { documentRef: { id: 'edit' }, sequenceRef: { id: 'edit:seq' }, itemRefs: [{ kind: 'video_edit.item', id: 'edit:item-1' }] } })
  expect((stopped as { message: string }).message).toContain('暂停不占时间线，画面与声音链接成一组')
  const stop = RECORDING_CAPABILITIES.find(item => item.id === 'stop_screen_recording')!
  expect(stop.outputSchema.safeParse({ ...stopped, revision: 0, scopeRevisions: {} }).success).toBe(true)
  const saved = await provider.readEntity(started.resultRef as { kind: string; id: string }, {})
  expect(saved.properties['screen_recording.session.elapsed_ms']).toBe(6000)
  expect(saved.properties['screen_recording.session.details']).toMatchObject({ events: 0, markers: 0, recorder: 'ffmpeg_or_browser' })
  expect(saved.properties['screen_recording.session.details']).not.toHaveProperty('frameTiming')
  // 原生采集在画面旁写了时刻表与活动时间线：读回能看出录法，两样文件各自是否留下。
  state.files.add('/s.frames')
  expect((await provider.readEntity(started.resultRef as { kind: string; id: string }, {})).properties['screen_recording.session.details']).toMatchObject({
    recorder: 'native', frameTiming: { path: '/s.frames', exists: true }, activity: { path: '/s.activity.jsonl', exists: false } })
  state.files.clear()
})

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

it('音频编辑正在录音时录屏照常开麦克风（两边共用一路采集）；快速模式与界面一样不录摄像头', async () => {
  state.saved = { ...DEFAULT_RECORDING_SETUP, mode: 'quick', microphone: true, systemAudio: false, camera: true }
  state.audioEditRecording = true
  state.prepared.mockClear()
  const handlers = new Map<string, CapabilityHandler>()
  screenRecordingApplicationDomain.registerCapabilities({ registerHandler: (id, handler) => { handlers.set(id, handler) } })
  const start = RECORDING_CAPABILITIES.find(item => item.id === 'start_screen_recording')!
  const signal = new AbortController().signal
  try {
    const started = await handlers.get('start_screen_recording')!(start.inputSchema.parse({ name: '课', sourceRef: { kind: 'screen_recording.source', id: 'screen:1:0' } }), { signal })
    expect(started.message).toContain('接到它正在用的设备')
    expect((state.prepared.mock.calls[0] as [string, unknown, { tracks: unknown }])[2].tracks).toEqual({ microphone: {}, systemAudio: false })
    await handlers.get('stop_screen_recording')!({ sessionRef: started.resultRef }, { signal })
  } finally { state.audioEditRecording = false }
})

const startOptions = { sourceId: 'window:42:0', width: 1920, height: 1080, fps: 30 } as Parameters<typeof startRecording>[0]
const idle = async (): Promise<void> => { await vi.waitFor(() => expect(recordingView()).toMatchObject({ busy: false, snapshot: null })) }
it('被录的窗口关闭：主进程按停止收尾后界面放开“当前录制”，助手再停止如实说明原因，马上能开始新的录制', async () => {
  const handlers = new Map<string, CapabilityHandler>()
  screenRecordingApplicationDomain.registerCapabilities({ registerHandler: (id, handler) => { handlers.set(id, handler) } })
  const id = await startRecording(startOptions, { name: '课程', tracks: { systemAudio: false } })
  Object.assign(state.content!, { status: 'stopped', startUs: 0, endUs: 2_000_000, media: [{ id: 'screen', kind: 'screen', path: '/s.mp4', monoUs: 0, durationUs: 2_000_000 }] })
  state.snapshot = { ...state.snapshot!, phase: 'stopped', busy: false, sourceEnded: 'window' }
  state.changed?.(state.snapshot)
  await idle()
  const stopped = await handlers.get('stop_screen_recording')!({ sessionRef: { kind: 'screen_recording.session', id } }, { signal: new AbortController().signal })
  expect(stopped).toMatchObject({ verified: true }); expect(stopped.message).toContain('被录制的窗口已关闭')
  await expect(startRecording(startOptions, { name: '下一段', tracks: { systemAudio: false } })).resolves.toBeTruthy()
  await handlers.get('cancel_screen_recording')!({ sessionRef: { kind: 'screen_recording.session', id: recordingView().documentId! } }, { signal: new AbortController().signal })
})
it('采集出错（主进程已把已录部分收尾保存）：界面随即放开“当前录制”，不用先恢复就能开始新的录制', async () => {
  const handlers = new Map<string, CapabilityHandler>()
  screenRecordingApplicationDomain.registerCapabilities({ registerHandler: (id, handler) => { handlers.set(id, handler) } })
  vi.mocked(importRecordingToVideo).mockClear()
  await startRecording(startOptions, { name: '课程', tracks: { systemAudio: false } })
  state.content!.status = 'interrupted'
  state.snapshot = { ...state.snapshot!, phase: 'failed', busy: false, error: '录制操作未完成' }
  state.changed?.(state.snapshot)
  await idle()
  expect(importRecordingToVideo).not.toHaveBeenCalled()
  const next = await startRecording(startOptions, { name: '下一段', tracks: { systemAudio: false } })
  await handlers.get('cancel_screen_recording')!({ sessionRef: { kind: 'screen_recording.session', id: next } }, { signal: new AbortController().signal })
})
