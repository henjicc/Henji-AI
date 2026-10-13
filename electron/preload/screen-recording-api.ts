import type { ScreenRecordingPlatform } from '../../src/platform/contracts/screenRecording'
import type { RecordingControlSnapshot } from '../../src/core/screenRecording/contracts'

export function createScreenRecordingApi(invoke: <T>(channel: string, payload?: unknown) => Promise<T>, subscribe: (channel: string, listener: (payload: unknown) => void) => () => void): ScreenRecordingPlatform {
  return {
    sources: (excludedSourceIds = []) => invoke('screenRecording:request', { action: 'sources', excludedSourceIds }),
    permissions: () => invoke('screenRecording:request', { action: 'permissions' }),
    grant: input => invoke('screenRecording:request', { action: 'grant', ...input }),
    revoke: sessionId => invoke('screenRecording:request', { action: 'revoke', sessionId }),
    openPermissionSettings: kind => invoke('screenRecording:request', { action: 'settings', kind }),
    snapshot: () => invoke('screenRecording:request', { action: 'snapshot' }),
    control: (sessionId, command) => invoke('screenRecording:request', { action: 'control', sessionId, command }),
    shortcuts: shortcuts => invoke('screenRecording:request', { action: 'shortcuts', shortcuts }),
    onChanged: listener => subscribe('screenRecording:changed', payload => listener(payload as RecordingControlSnapshot | null)),
  }
}
