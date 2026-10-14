import type { ScreenRecordingPlatform } from '../../contracts/screenRecording'

function native(): ScreenRecordingPlatform {
  if (!window.henjiNative?.screenRecording) throw new Error('屏幕录制仅在桌面应用中可用')
  return window.henjiNative.screenRecording
}
export function createElectronScreenRecording(): ScreenRecordingPlatform {
  return {
    clock: () => native().clock(), trackStatus: (sessionId, status) => native().trackStatus(sessionId, status),
    recordCapability: (id, fact) => native().recordCapability(id, fact),
    sources: ids => native().sources(ids), permissions: () => native().permissions(),
    grant: input => native().grant(input), revoke: id => native().revoke(id),
    openPermissionSettings: kind => native().openPermissionSettings(kind),
    snapshot: () => native().snapshot(), control: (id, action, note) => native().control(id, action, note),
    shortcuts: keys => native().shortcuts(keys), onChanged: listener => native().onChanged(listener),
  }
}
