import { AUDIO_CAPTURE_CHANNEL, AUDIO_CAPTURE_EVENT_CHANNEL, type AudioCapturePlatform } from '../../src/platform/contracts/audioCapture'
import type { AudioCaptureEvent } from '../../src/core/audioCapture/contracts'
type Invoke = <T>(channel: string, payload?: unknown) => Promise<T>
type Subscribe = (channel: string, listener: (payload: unknown) => void) => () => void
export function createAudioCaptureApi(invoke: Invoke, subscribe: Subscribe): AudioCapturePlatform {
  let deviceWatchers = 0
  const acknowledged = new Map<string, number>()
  const listen = (handler: (event: AudioCaptureEvent) => void, acknowledgeSamples: boolean) => subscribe(AUDIO_CAPTURE_EVENT_CHANNEL, payload => {
    const event = payload as AudioCaptureEvent
    try { handler(event) } finally {
      if (acknowledgeSamples && event.event === 'samples') {
        if (event.sequence - (acknowledged.get(event.sessionId) ?? -1) >= 8) {
          acknowledged.set(event.sessionId, event.sequence)
          void invoke(AUDIO_CAPTURE_CHANNEL, { action: 'ack', sessionId: event.sessionId, sequence: event.sequence }).catch(() => undefined)
        }
      }
    }
  })
  return {
    prepareFile: placement => invoke(AUDIO_CAPTURE_CHANNEL, { action: 'prepareFile', ...(placement ? { placement } : {}) }),
    pendingFiles: () => invoke(AUDIO_CAPTURE_CHANNEL, { action: 'pendingFiles' }),
    completeFile: outputPath => invoke(AUDIO_CAPTURE_CHANNEL, { action: 'completeFile', outputPath }),
    trashFile: outputPath => invoke(AUDIO_CAPTURE_CHANNEL, { action: 'trashFile', outputPath }),
    enumerate: () => invoke(AUDIO_CAPTURE_CHANNEL, { action: 'enumerate' }),
    probe: settings => invoke(AUDIO_CAPTURE_CHANNEL, { action: 'probe', settings }),
    getSettings: () => invoke(AUDIO_CAPTURE_CHANNEL, { action: 'settings' }),
    setSettings: (settings, expectedRevision) => invoke(AUDIO_CAPTURE_CHANNEL, { action: 'setSettings', settings, expectedRevision }),
    start: request => invoke(AUDIO_CAPTURE_CHANNEL, { action: 'start', request }),
    pause: sessionId => invoke(AUDIO_CAPTURE_CHANNEL, { action: 'pause', sessionId }),
    resume: sessionId => invoke(AUDIO_CAPTURE_CHANNEL, { action: 'resume', sessionId }),
    stop: async sessionId => { try { return await invoke(AUDIO_CAPTURE_CHANNEL, { action: 'stop', sessionId }) } finally { acknowledged.delete(sessionId) } },
    status: sessionId => invoke(AUDIO_CAPTURE_CHANNEL, { action: 'status', sessionId }),
    clock: () => invoke(AUDIO_CAPTURE_CHANNEL, { action: 'clock' }),
    recover: outputPath => invoke(AUDIO_CAPTURE_CHANNEL, { action: 'recover', outputPath }),
    openAsioPanel: settings => invoke(AUDIO_CAPTURE_CHANNEL, { action: 'asioPanel', settings }),
    onEvent: handler => listen(handler, true),
    onLevel: handler => listen(event => { if (event.event === 'level') handler(event) }, false),
    onSamples: handler => listen(event => { if (event.event === 'samples') handler(event) }, true),
    onDevicesChanged: handler => {
      const release = listen(event => { if (event.event === 'devicesChanged') handler(event.inventory) }, false)
      if (++deviceWatchers === 1) void invoke(AUDIO_CAPTURE_CHANNEL, { action: 'watchDevices', enabled: true }).catch(() => undefined)
      let removed = false
      return () => { if (removed) return; removed = true; release(); if (--deviceWatchers === 0) void invoke(AUDIO_CAPTURE_CHANNEL, { action: 'watchDevices', enabled: false }).catch(() => undefined) }
    },
  }
}
