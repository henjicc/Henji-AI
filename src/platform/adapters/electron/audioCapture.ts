import type { AudioCapturePlatform } from '../../contracts/audioCapture'
function native(): AudioCapturePlatform {
  if (!window.henjiNative?.audioCapture) throw new Error('原生录音服务不可用')
  return window.henjiNative.audioCapture
}
export function createElectronAudioCapture(): AudioCapturePlatform {
  return {
    enumerate: () => native().enumerate(), probe: settings => native().probe(settings),
    getSettings: () => native().getSettings(), setSettings: (settings, revision) => native().setSettings(settings, revision),
    start: request => native().start(request), pause: id => native().pause(id), resume: id => native().resume(id), stop: id => native().stop(id), status: id => native().status(id),
    clock: () => native().clock(), recover: path => native().recover(path), openAsioPanel: settings => native().openAsioPanel(settings),
    onEvent: handler => native().onEvent(handler), onLevel: handler => native().onLevel(handler), onSamples: handler => native().onSamples(handler), onDevicesChanged: handler => native().onDevicesChanged(handler),
  }
}
