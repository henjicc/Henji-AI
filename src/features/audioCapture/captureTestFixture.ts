import { vi } from 'vitest'
import { DEFAULT_AUDIO_CAPTURE_SETTINGS, type AudioCaptureEvent, type AudioCaptureInventory, type AudioCaptureSettingsState, type AudioCaptureStatus } from '@/core/audioCapture/contracts'
import type { AudioCapturePlatform } from '@/platform/contracts/audioCapture'

export const captureInventory: AudioCaptureInventory = {
  hostApis: [{ id: 'WASAPI', name: 'Windows WASAPI', defaultInputDevice: 1 }, { id: 'ASIO', name: 'ASIO', defaultInputDevice: 3 }], defaultInputDevice: 1, asioCompiled: true,
  devices: [1, 2, 3].map(index => ({ index, hostApi: index === 3 ? 'ASIO' : 'WASAPI', name: index === 3 ? '驱动' : '麦克风', maxInputChannels: index === 3 ? 8 : 2, maxOutputChannels: 0, defaultSampleRate: 48000, defaultLowInputLatency: .01, defaultHighInputLatency: .1, defaultLowOutputLatency: 0, defaultHighOutputLatency: 0, asioBuffers: index === 3 ? { min: 64, max: 2048, preferred: 256, granularity: 0 } : null })),
}
export function captureFixture(): { api: AudioCapturePlatform; emit: (event: AudioCaptureEvent) => void; state: AudioCaptureSettingsState; status: AudioCaptureStatus } {
  const state: AudioCaptureSettingsState = { settings: { ...DEFAULT_AUDIO_CAPTURE_SETTINGS, hostApi: 'WASAPI' }, effectiveSettings: { ...DEFAULT_AUDIO_CAPTURE_SETTINGS, hostApi: 'WASAPI', deviceName: '麦克风' }, notice: null, revision: 1 }
  const status: AudioCaptureStatus = { sessionId: 'session', outputPath: 'D:/作品/录音/录音 2026-10-23 120000.wav', state: 'recording', sampleRate: 48000, inputLatency: .01, callbackFrames: 256, frames: 0, writtenBytes: 0, durationSeconds: 0 }
  const listeners = new Set<(event: AudioCaptureEvent) => void>()
  const api: AudioCapturePlatform = {
    getSettings: vi.fn(async () => state), setSettings: vi.fn(async settings => ({ ...state, settings, effectiveSettings: settings, revision: state.revision + 1 })), enumerate: vi.fn(async () => captureInventory),
    probe: vi.fn(async () => ({ formats: [16, 24, 32].map(bitDepth => ({ bitDepth, sampleRate: 48000, supported: bitDepth !== 32 })) })),
    prepareFile: vi.fn(async () => ({ outputPath: status.outputPath, name: '录音.wav' })), pendingFiles: vi.fn(async () => []), completeFile: vi.fn(async () => {}), trashFile: vi.fn(async () => {}),
    start: vi.fn(async () => ({ ...status, notice: null })), pause: vi.fn(async () => ({ ...status, state: 'paused' as const })), resume: vi.fn(async () => ({ ...status, state: 'recording' as const })), stop: vi.fn(async () => ({ ...status, state: 'stopped' as const, durationSeconds: 3 })), status: vi.fn(async () => status),
    clock: vi.fn(async () => ({ mainUs: 0, uncertaintyUs: 0 })), recover: vi.fn(async () => ({ writtenBytes: 432000 })), openAsioPanel: vi.fn(async () => {}),
    onEvent: vi.fn(handler => { listeners.add(handler); return () => { listeners.delete(handler) } }), onLevel: vi.fn(() => () => {}), onSamples: vi.fn(() => () => {}), onDevicesChanged: vi.fn(() => () => {}),
  }
  return { api, state, status, emit: event => listeners.forEach(listener => listener(event)) }
}
