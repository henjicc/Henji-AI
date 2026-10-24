import type { AppInfoValue, WebRecordingEnvironment, WebRecordingManifest } from '../../core/webReplay/schema'
import type { RecordingEncoding } from '../../core/screenRecording/encoding'
import type { CaptureEvent } from '../../core/captureLog/events'
import type { RecordingCursorSource } from '../../core/videoEdit/recordingCursor'

export const WEB_REPLAY_CHANNELS = {
  apps: 'webReplay:apps',
  start: 'webReplay:start',
  stop: 'webReplay:stop',
  recordings: 'webReplay:recordings',
  remove: 'webReplay:remove',
  restore: 'webReplay:restore',
  renderProgress: 'webReplay:render-progress',
  render: 'webReplay:render',
  read: 'webReplay:read',
  reveal: 'webReplay:reveal',
  rename: 'webReplay:rename',
  exportVideos: 'webReplay:export-videos',
  backupAudioDirectory: 'webReplay:backup-audio-directory',
  mixBackupAudio: 'webReplay:mix-backup-audio',
  setEnabled: 'webReplay:set-enabled',
  importToProject: 'webReplay:import-to-project',
  editSource: 'webReplay:edit-source',
  appsChanged: 'webReplay:apps-changed',
} as const

export interface WebReplayConnectedApp {
  connectionId: string
  app: AppInfoValue
  host: WebRecordingManifest['host']
  env: WebRecordingEnvironment
  probeVersion: string
  /** The recording this app is producing right now, if any. */
  recordingId: string | null
  /** Wall-clock ms when that recording actually started (after the app reloaded). */
  recordingStartedAt: number | null
}

/**
 * A saved recording plus its most recent replay video and the window backup video, when they exist.
 * `directory` is the recording folder: `<项目>/素材/录屏/<名称>.hjweb` for project recordings (`projectId` set),
 * the app-data `web-recordings/<id>` folder otherwise.
 */
export type WebRecordingSummary = WebRecordingManifest & { video: string | null; backupVideo: string | null; directory: string; projectId: string | null }

/** Where a new recording goes: a project (written as `素材/录屏/<名称>.hjweb`). Without one it goes to app data. */
export interface WebRecordingDestination { projectId: string; name?: string }

/**
 * Brings a recording folder into a project as `.hjweb`: an existing recording by id, or any recording folder on disk
 * (one copied elsewhere, the old app-data layout). The source is copied, never moved or changed; the copy gets a new
 * id when its id is already used.
 */
export interface WebRecordingImportRequest { projectId: string; recordingId?: string; source?: string; name?: string }

/**
 * The video a recording brings into an edit, with the behavior track projected onto that video's clock and pixels.
 * `cursor` is null when there was no pointer to place (no clock, or the picture does not match the page).
 */
export interface WebRecordingEditSource {
  video: string
  kind: 'replay' | 'backup'
  width: number
  height: number
  durationUs: number
  title: string | null
  cursor: RecordingCursorSource | null
  /** Click and key events on the video clock, for suggesting zoom regions. */
  events: CaptureEvent[]
  warnings: string[]
}
export interface WebReplayRenderProgress { recordingId: string; progress: number; frame: string }

export interface WebReplayServerState { enabled: boolean; listening: boolean; port: number; error?: string; apps: WebReplayConnectedApp[] }

/** `output` defaults to a new file inside the recording directory. */
/** pointer=false renders a clean picture (no pointer drawn in the page) for the editor; omitted keeps the pointer for viewing. */
export interface WebReplayRenderRequest { recordingId: string; output?: string; fps?: number; pointer?: boolean }
export interface WebReplayRenderResult {
  output: string
  frames: number
  width: number
  height: number
  durationMs: number
  issues: Array<{ t: number; kind: 'conflict' | 'warning'; message: string }>
  looseMatches: number
  unusedCalls: number
  locatorMisses: number
}

export interface WebReplayReadRequest { recordingId: string; track: 'data' | 'behavior'; offset: number; limit: number }
export interface WebReplayReadResult { entries: unknown[]; total: number; nextOffset: number | null }

/**
 * The plain screen recording kept beside a web recording. `window` records the app's own window at
 * its size; `screen` records a whole monitor at the chosen resolution. Encoding matches screen recording.
 */
export type WebRecordingBackupOptions = RecordingEncoding & { fps: 30 | 60 } & ({ target: 'window' } | { target: 'screen'; sourceId: string; width: number; height: number })

export interface WebReplayPlatform {
  /** Experimental switch: starts or stops listening for probes on the local port. */
  setEnabled(enabled: boolean): Promise<WebReplayServerState>
  apps(): Promise<WebReplayServerState>
  /** `backup` null records data only. */
  start(connectionId: string, backup: WebRecordingBackupOptions | null, destination?: WebRecordingDestination | null): Promise<WebRecordingManifest>
  stop(recordingId: string): Promise<WebRecordingManifest>
  recordings(): Promise<WebRecordingSummary[]>
  /** Moves a recording to the trash folder; `restore` brings it back. */
  remove(recordingId: string): Promise<void>
  restore(recordingId: string): Promise<void>
  /** Live frames while a replay renders (about five per second). */
  onRenderProgress(listener: (event: WebReplayRenderProgress) => void): () => void
  render(request: WebReplayRenderRequest): Promise<WebReplayRenderResult>
  read(request: WebReplayReadRequest): Promise<WebReplayReadResult>
  /** Shows a file of this recording (a rendered video) or its folder in the system file manager. */
  reveal(recordingId: string, file?: string): Promise<void>
  onAppsChanged(listener: (state: WebReplayServerState) => void): () => void
  /** `title` null goes back to the app name plus time. */
  rename(items: Array<{ recordingId: string; title: string | null }>): Promise<void>
  /** Copies each recording's backup and newest replay video into `directory`, named after the recording. */
  exportVideos(recordingIds: string[], directory: string): Promise<WebRecordingExportResult>
  /** Where the recording page writes the backup recording's sound while recording. */
  backupAudioDirectory(recordingId: string): Promise<string>
  /** Lays that sound into backup.mp4 once the recording is saved; false when there was none. */
  mixBackupAudio(recordingId: string): Promise<boolean>
  importToProject(request: WebRecordingImportRequest): Promise<WebRecordingSummary>
  /** `prefer` picks the replay or the backup video; `auto` takes the newest replay, else the backup. */
  editSource(recordingId: string, prefer?: 'replay' | 'backup' | 'auto'): Promise<WebRecordingEditSource>
}

export interface WebRecordingExportResult { files: string[]; skipped: number }
