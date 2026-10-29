import type { WebReplayPlatform } from '../../contracts/webReplay'
import { contentTrustConfirmation } from '../../contentTrustConfirmation'

function native(): WebReplayPlatform {
  const api = window.henjiNative?.webReplay as WebReplayPlatform | undefined
  if (!api) throw new Error('网页应用录制不可用，请重新启动应用。')
  return api
}

export function createElectronWebReplay(): WebReplayPlatform {
  return {
    setEnabled: enabled => native().setEnabled(enabled),
    apps: () => native().apps(),
    start: (id, backup, destination) => native().start(id, backup, destination),
    stop: id => native().stop(id),
    recordings: () => native().recordings(),
    remove: id => native().remove(id),
    restore: id => native().restore(id),
    onRenderProgress: listener => native().onRenderProgress(listener),
    render: async (request, jobId) => { await contentTrustConfirmation().prepare('web_recording', request.recordingId); return native().render(request, jobId) },
    cancelRender: target => native().cancelRender(target),
    read: request => native().read(request),
    reveal: (id, file) => native().reveal(id, file),
    rename: items => native().rename(items),
    exportVideos: (ids, directory) => native().exportVideos(ids, directory),
    backupAudioDirectory: id => native().backupAudioDirectory(id),
    mixBackupAudio: id => native().mixBackupAudio(id),
    importToProject: request => native().importToProject(request),
    editSource: (id, prefer, take) => native().editSource(id, prefer, take),
    onAppsChanged: listener => native().onAppsChanged(listener),
  }
}
