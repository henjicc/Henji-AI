/*
 * 剪辑导出在主进程的内存登记。编码与封装留在渲染层；主进程保存每项的描述、提交时的快照与状态，
 * 并由它自己独占创建输出文件、记下文件身份。渲染层整页重载或崩溃后，新页面据此恢复排队项，
 * 正在跑的项标成“已中断”，并清理主进程替它创建、尚未发布的未完成文件。
 * 实现在 `electron/main/services/video-edit-export/jobRegistry.ts`，渲染层入口是 `videoEditExportRegistry.ts`。
 */

export const VIDEO_EDIT_EXPORT_CHANNELS = {
  register: 'video-edit-export:register',
  update: 'video-edit-export:update',
  createOutput: 'video-edit-export:create-output',
  outputPublished: 'video-edit-export:output-published',
  discardLeftovers: 'video-edit-export:discard-leftovers',
  remove: 'video-edit-export:remove',
  restore: 'video-edit-export:restore',
} as const

export type VideoEditExportJobState = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'

export interface VideoEditExportJobRegistration {
  id: string
  projectId: string
  name: string
  presetName: string
  /** 这一项可能写出的全部文件（成片与同名字幕）；只有这些路径能经登记创建。 */
  outputPaths: string[]
  /** false：只保护输出文件，界面重载后不恢复（如发送到画布的临时导出）。 */
  restorable: boolean
  /** 指向同一次登记里 `snapshots` 的下标；同一序列的多项共用一份快照。 */
  snapshotIndex?: number
  /** 渲染层自己的恢复数据（设置、区间等），主进程原样保存、不解释。 */
  payload?: unknown
}

export interface VideoEditExportRegistrationRequest {
  /** 快照的 JSON 文本：主进程先按字节数判断上限，不解析内容。 */
  snapshots: string[]
  jobs: VideoEditExportJobRegistration[]
}

/** retained=false 时导出照常进行，但界面重载后不会保留这一项。 */
export interface VideoEditExportRegistrationResult {
  id: string
  retained: boolean
  reason?: 'snapshot_too_large' | 'registry_full'
}

export interface VideoEditExportJobUpdate {
  id: string
  state: VideoEditExportJobState
  progress: number
  error?: string
}

export interface VideoEditExportJobRecord {
  id: string
  projectId: string
  name: string
  presetName: string
  outputPaths: string[]
  /** 登记时的快照 JSON；未保留快照的项不会被取回。 */
  snapshotJson?: string
  payload: unknown
  state: VideoEditExportJobState
  progress: number
  error?: string
  /** 成片已写完并进入发布流程；之后再中断也不删除文件、不允许重试。 */
  outputPublished: boolean
}

export interface VideoEditExportPlatform {
  register(request: VideoEditExportRegistrationRequest): Promise<VideoEditExportRegistrationResult[]>
  update(update: VideoEditExportJobUpdate): Promise<void>
  /** 由主进程独占创建空的输出文件并记下文件身份；已有同名文件时失败，不覆盖。 */
  createOutput(id: string, path: string): Promise<void>
  outputPublished(id: string): Promise<void>
  /** 重试前清理这一项此前创建、仍未发布的文件（只删身份未变的那个文件）。 */
  discardLeftovers(id: string): Promise<void>
  remove(ids: string[]): Promise<void>
  /** 取回上一页面留下的导出项（排队、已中断、失败），并改由当前页面接管。 */
  restore(): Promise<VideoEditExportJobRecord[]>
}
