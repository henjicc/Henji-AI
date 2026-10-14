import type { ScreenRecordingPlatform } from '../../src/platform/contracts/screenRecording'
import type { RecordingControlSnapshot } from '../../src/core/screenRecording/contracts'
import type { CaptureCommand } from '../../src/core/screenRecording/capture'

export function createScreenRecordingApi(invoke: <T>(channel: string, payload?: unknown) => Promise<T>, subscribe: (channel: string, listener: (payload: unknown) => void) => () => void): ScreenRecordingPlatform {
  return {
    clock: () => invoke('screenRecording:request', { action: 'clock' }),
    trackStatus: (sessionId, status) => invoke('screenRecording:request', { action: 'track-status', sessionId, status }),
    capture: request => invoke('screenRecording:request', { action: 'capture', request }),
    onCaptureCommand: listener => subscribe('screenRecording:captureCommand', payload => listener(payload as CaptureCommand)),
    recordCapability: (sessionId, fact) => invoke('screenRecording:request', { action: 'capability', sessionId, fact }),
    sources: (excludedSourceIds = []) => invoke('screenRecording:request', { action: 'sources', excludedSourceIds }),
    permissions: () => invoke('screenRecording:request', { action: 'permissions' }),
    grant: input => invoke('screenRecording:request', { action: 'grant', ...input }),
    revoke: sessionId => invoke('screenRecording:request', { action: 'revoke', sessionId }),
    openPermissionSettings: kind => invoke('screenRecording:request', { action: 'settings', kind }),
    snapshot: () => invoke('screenRecording:request', { action: 'snapshot' }),
    control: (sessionId, command, note) => invoke('screenRecording:request', { action: 'control', sessionId, command, ...(note === undefined ? {} : { note }) }),
    shortcuts: shortcuts => invoke('screenRecording:request', { action: 'shortcuts', shortcuts }),
    onChanged: listener => subscribe('screenRecording:changed', payload => listener(payload as RecordingControlSnapshot | null)),
  }
}
