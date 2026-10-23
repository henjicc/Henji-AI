import type { AppInfoValue, WebRecordingEnvironment, WebRecordingManifest } from '../../core/webReplay/schema'

export const WEB_REPLAY_CHANNELS = {
  apps: 'webReplay:apps',
  start: 'webReplay:start',
  stop: 'webReplay:stop',
  recordings: 'webReplay:recordings',
  render: 'webReplay:render',
  read: 'webReplay:read',
  reveal: 'webReplay:reveal',
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
}

export interface WebReplayServerState { listening: boolean; port: number; error?: string; apps: WebReplayConnectedApp[] }

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
  apps(): Promise<WebReplayServerState>
  start(connectionId: string): Promise<WebRecordingManifest>
  stop(recordingId: string): Promise<WebRecordingManifest>
  recordings(): Promise<WebRecordingManifest[]>
  render(request: WebReplayRenderRequest): Promise<WebReplayRenderResult>
  read(request: WebReplayReadRequest): Promise<WebReplayReadResult>
  /** Shows a file of this recording (a rendered video) or its folder in the system file manager. */
  reveal(recordingId: string, file?: string): Promise<void>
  onAppsChanged(listener: (state: WebReplayServerState) => void): () => void
}
