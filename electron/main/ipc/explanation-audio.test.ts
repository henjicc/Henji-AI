import { beforeEach, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { recordingAudioRequestSchema, type RecordingAudioRequest } from '../../../src/core/audioEdit/recordingAudio'
import { registerExplanationAudioHandlers } from './explanation-audio'
const hooks = vi.hoisted(() => ({ handler: undefined as ((input: RecordingAudioRequest, event: IpcMainInvokeEvent) => unknown) | undefined, cancel: vi.fn(), write: vi.fn() }))
vi.mock('electron', () => ({ app: { on: vi.fn() }, session: { defaultSession: {} } }))
vi.mock('../services/media-permissions', () => ({ mediaPermissions: { install: vi.fn() } }))
vi.mock('./registry', () => ({ registerIpcHandler: (_channel: string, _parse: unknown, handler: typeof hooks.handler) => { hooks.handler = handler } }))
vi.mock('./application-control', () => ({ assertTrustedApplicationSender: vi.fn() }))
vi.mock('../services/logging', () => ({ createMainLogger: () => ({ warn: vi.fn() }) }))
vi.mock('../services/audio-edit/explanation-audio', () => ({ explanationAudioService: { cleanupExpired: vi.fn(async () => {}), cancel: hooks.cancel, write: hooks.write } }))
beforeEach(() => { vi.clearAllMocks(); registerExplanationAudioHandlers() })
it('旧浏览器麦克风授权入口移除，窗口离开仍取消自己持有的讲解写入', async () => {
  expect(recordingAudioRequestSchema.safeParse({ action: 'microphone', enabled: true, userReceipt: crypto.randomUUID() }).success).toBe(false)
  const handlers = new Map<string, () => void>()
  const event = { sender: { id: 1, on: (key: string, fn: () => void) => handlers.set(key, fn), once: (key: string, fn: () => void) => handlers.set(key, fn), removeListener: vi.fn() } } as unknown as IpcMainInvokeEvent
  const request = { action: 'write' as const, sessionId: crypto.randomUUID(), chunkId: crypto.randomUUID(), sampleRate: 48000, samples: new Float32Array(480) }
  await hooks.handler!(request, event)
  expect(hooks.write).toHaveBeenCalledWith(request)
  handlers.get('destroyed')!()
  expect(hooks.cancel).toHaveBeenCalledWith(request.sessionId)
})
