import type { AppInfoValue, WebRecordingEnvironment, WebRecordingManifest } from '../../core/webReplay/schema'

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
  setEnabled: 'webReplay:set-enabled',
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

/** A saved recording plus its most recent replay video and the window backup video, when they exist. */
export type WebRecordingSummary = WebRecordingManifest & { video: string | null; backupVideo: string | null }
export interface WebReplayRenderProgress { recordingId: string; progress: number; frame: string }

export interface WebReplayServerState { enabled: boolean; listening: boolean; port: number; error?: string; apps: WebReplayConnectedApp[] }

/** `output` defaults to a new file inside the recording directory. */
export interface WebReplayRenderRequest { recordingId: string; output?: string; fps?: number }
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

export interface WebReplayPlatform {
  /** Experimental switch: starts or stops listening for probes on the local port. */
  setEnabled(enabled: boolean): Promise<WebReplayServerState>
  apps(): Promise<WebReplayServerState>
  start(connectionId: string): Promise<WebRecordingManifest>
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
}
