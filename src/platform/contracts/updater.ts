export type UpdaterStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdaterReleaseInfo {
  version: string
  name: string
  body: string
  publishedAt: string
  htmlUrl: string
}

export interface UpdaterProgressInfo {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

export interface UpdaterCheckResult {
  status: UpdaterStatus
  hasUpdate: boolean
  currentVersion: string
  latestVersion?: string
  releaseInfo?: UpdaterReleaseInfo
  progress?: UpdaterProgressInfo
  errorMessage?: string
}

export type UpdaterEvent =
  | { type: 'checking'; result: UpdaterCheckResult }
  | { type: 'available'; result: UpdaterCheckResult }
  | { type: 'not-available'; result: UpdaterCheckResult }
  | { type: 'download-progress'; result: UpdaterCheckResult }
  | { type: 'downloaded'; result: UpdaterCheckResult }
  | { type: 'error'; result: UpdaterCheckResult }

export interface UpdaterPlatform {
  getStatus(): Promise<UpdaterCheckResult>
  checkForUpdates(): Promise<UpdaterCheckResult>
  downloadUpdate(): Promise<UpdaterCheckResult>
  quitAndInstall(): Promise<void>
  onEvent(handler: (event: UpdaterEvent) => void): () => void
}
