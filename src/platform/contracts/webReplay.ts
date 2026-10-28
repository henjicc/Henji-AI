import type { AppInfoValue, WebRecordingEnvironment, WebRecordingManifest } from '../../core/webReplay/schema'
import type { BoxTrackQuery } from '../../core/webReplay/boxTrackQuery'
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
  cancelRender: 'webReplay:cancel-render',
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
export type WebRecordingSummary = WebRecordingManifest & { video: string | null; backupVideo: string | null; directory: string; projectId: string | null; takes: WebRecordingTakeInfo[] }

/** A take: a replay rendered from a director script, in `takes/<name>/` of the recording folder (newest first). */
export interface WebRecordingTakeInfo { name: string; directory: string; video: string | null; frames: number; durationMs: number; fps: number; pointer: boolean; createdAt: string; conflicts: number }

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
  /** The take whose video this is (a replay rendered from a director script). */
  take?: string
}
export interface WebReplayRenderProgress { recordingId: string; progress: number; frame: string }

export interface WebReplayServerState { enabled: boolean; listening: boolean; port: number; error?: string; apps: WebReplayConnectedApp[] }

/** `output` defaults to a new file inside the recording directory. */
/** pointer=false renders a clean picture (no pointer drawn in the page) for the editor; omitted keeps the pointer for viewing. */
export interface WebReplayRenderRequest {
  recordingId: string; output?: string; fps?: number; pointer?: boolean; /** 输出长边像素；不给时按录制时的设备像素比 */ longEdge?: number; /** 只重演出文字与位置轨，不出视频 */ textOnly?: boolean; boxSelectors?: string[]
  /** 导演稿（web-replay-director 格式）：给了就按它出一个版本到 takes/<take>/，录制本身不动。与 directorFile 二选一。 */
  director?: unknown
  /** 导演稿 JSON 文件的本机路径。 */
  directorFile?: string
  /** 版本名（takes/ 下的文件夹名）；给了导演稿而没给名字时按时间起名。同名的旧版本在新版本写完后被替换。 */
  take?: string
}
/** 主进程登记的一次重演：渲染层重载后仍可按 jobId 查到结果。 */
export type WebReplayJobState = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
/** 按 jobId 取消调用方自己的重演，或按 recordingId 取消这段录制排队中或正在跑的重演。 */
export type WebReplayCancelTarget = { jobId: string } | { recordingId: string }
/** `previousState` 是取消时的状态；`state` 是等它停下后的状态（来不及停下时仍是 running）。 */
export interface WebReplayCancelResult { jobId: string; recordingId: string; previousState: 'queued' | 'running'; state: WebReplayJobState }
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
  /** 按导演稿出的版本。 */
  take?: WebRecordingTakeInfo & { steps: string[] }
}

/** `take`：读这个版本自己的轨道（boxes、text、behavior 在版本的输出时间上；timemap 是输出时间与录制时间的对照）。 */
export interface WebReplayReadRequest extends BoxTrackQuery { recordingId: string; track: 'data' | 'behavior' | 'text' | 'boxes' | 'timemap'; offset: number; limit: number; /** 文字轨按文字搜 */ query?: string; take?: string }
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
  /** `jobId` 是主进程登记这次重演用的标识（应用操作传自己的操作标识）；不给时主进程自起。 */
  render(request: WebReplayRenderRequest, jobId?: string): Promise<WebReplayRenderResult>
  cancelRender(target: WebReplayCancelTarget): Promise<WebReplayCancelResult>
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
  /** `prefer` picks the replay or the backup video; `auto` takes the newest replay, else the backup. `take` uses that take's video and track instead. */
  editSource(recordingId: string, prefer?: 'replay' | 'backup' | 'auto', take?: string): Promise<WebRecordingEditSource>
}

export interface WebRecordingExportResult { files: string[]; skipped: number }
