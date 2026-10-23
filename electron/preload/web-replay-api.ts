import { WEB_REPLAY_CHANNELS, type WebReplayPlatform, type WebReplayRenderProgress, type WebReplayServerState } from '../../src/platform/contracts/webReplay'

export function createWebReplayApi(invoke: <T>(channel: string, payload?: unknown) => Promise<T>, subscribe: (channel: string, handler: (payload: unknown) => void) => () => void): WebReplayPlatform {
  return {
    setEnabled: enabled => invoke(WEB_REPLAY_CHANNELS.setEnabled, { enabled }),
    apps: () => invoke(WEB_REPLAY_CHANNELS.apps),
    start: (connectionId, backup) => invoke(WEB_REPLAY_CHANNELS.start, { connectionId, backup }),
    stop: recordingId => invoke(WEB_REPLAY_CHANNELS.stop, { recordingId }),
    recordings: () => invoke(WEB_REPLAY_CHANNELS.recordings),
    remove: recordingId => invoke(WEB_REPLAY_CHANNELS.remove, { recordingId }),
    restore: recordingId => invoke(WEB_REPLAY_CHANNELS.restore, { recordingId }),
    onRenderProgress: handler => subscribe(WEB_REPLAY_CHANNELS.renderProgress, value => handler(value as WebReplayRenderProgress)),
    render: request => invoke(WEB_REPLAY_CHANNELS.render, request),
    read: request => invoke(WEB_REPLAY_CHANNELS.read, request),
    reveal: (recordingId, file) => invoke(WEB_REPLAY_CHANNELS.reveal, { recordingId, ...(file ? { file } : {}) }),
    rename: items => invoke(WEB_REPLAY_CHANNELS.rename, { items }),
    exportVideos: (recordingIds, directory) => invoke(WEB_REPLAY_CHANNELS.exportVideos, { recordingIds, directory }),
    backupAudioDirectory: recordingId => invoke(WEB_REPLAY_CHANNELS.backupAudioDirectory, { recordingId }),
    mixBackupAudio: recordingId => invoke(WEB_REPLAY_CHANNELS.mixBackupAudio, { recordingId }),
    onAppsChanged: handler => subscribe(WEB_REPLAY_CHANNELS.appsChanged, value => handler(value as WebReplayServerState)),
  }
}
