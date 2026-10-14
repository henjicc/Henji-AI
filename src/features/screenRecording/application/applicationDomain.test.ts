import { expect, it, vi } from 'vitest'
import type { CapabilityHandler } from '@/features/application-control/capabilities/handlerTypes'
import type { RecordingControlSnapshot } from '@/core/screenRecording/contracts'
import type { RecordingDocument } from '@/core/screenRecording/document'
import { createRecordingDocument } from '@/core/screenRecording/document'
import { RECORDING_CAPABILITIES } from '@/core/application-control/domains/screenRecording/recordingCapabilities'

const state = vi.hoisted(() => ({ content: undefined as RecordingDocument | undefined, snapshot: null as RecordingControlSnapshot | null, changed: undefined as ((snapshot: RecordingControlSnapshot | null) => void) | undefined, grant: vi.fn(), revoke: vi.fn(), events: vi.fn() }))
vi.mock('@/platform', () => ({ getPlatform: () => ({
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
vi.mock('../capture/session', () => ({ prepareScreenCapture: async (id: string) => {
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
