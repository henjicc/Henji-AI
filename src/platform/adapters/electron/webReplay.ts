import type { WebReplayPlatform } from '../../contracts/webReplay'

function native(): WebReplayPlatform {
  const api = window.henjiNative?.webReplay as WebReplayPlatform | undefined
  if (!api) throw new Error('网页应用录制不可用，请重新启动应用。')
  return api
}

export function createElectronWebReplay(): WebReplayPlatform {
  return {
    setEnabled: enabled => native().setEnabled(enabled),
    apps: () => native().apps(),
    start: (id, backup) => native().start(id, backup),
    stop: id => native().stop(id),
    recordings: () => native().recordings(),
    remove: id => native().remove(id),
    restore: id => native().restore(id),
    onRenderProgress: listener => native().onRenderProgress(listener),
    render: request => native().render(request),
    read: request => native().read(request),
    reveal: (id, file) => native().reveal(id, file),
    onAppsChanged: listener => native().onAppsChanged(listener),
  }
}
