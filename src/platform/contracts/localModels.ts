/*
 * 本地模型（任务 4.11）：抠像、检测、跟踪这类必须逐帧在本机跑的小模型，第一次用到时下载。
 *
 * 文件放在作品目录的“模型/<模型名>/”下，每个文件按清单里写死的 SHA-256 校验；下载源在国内
 * （ModelScope）与国外（Hugging Face / GitHub）之间自动选择，失败自动换源。
 * 主进程实现在 `electron/main/services/local-models/`，渲染层经 `src/commands/localModels.ts` 调用。
 */

/** 清单里登记的模型；新增模型时同时扩展这里与主进程清单。 */
export const LOCAL_MODEL_IDS = [
  'face_detection_yunet',
  'person_matting_rvm',
  'selfie_segmentation',
  'text_detection_ppocr',
  'object_tracking_vittrack',
  'object_tracking_efficienttam',
] as const

export type LocalModelId = (typeof LOCAL_MODEL_IDS)[number]

export function isLocalModelId(value: unknown): value is LocalModelId {
  return typeof value === 'string' && (LOCAL_MODEL_IDS as readonly string[]).includes(value)
}

/**
 * - `not_downloaded`：还没下载（或已删除）
 * - `downloading`：正在下载或校验
 * - `ready`：文件齐全且校验通过
 * - `corrupt`：文件存在但大小或校验值不对（被改动、下载中断残留），需要重新下载
 * - `unavailable`：暂时没有可下载的文件（如需要另行导出的模型）
 */
export type LocalModelStatus = 'not_downloaded' | 'downloading' | 'ready' | 'corrupt' | 'unavailable'

/** 下载源选择：自动（先探测哪边快）/ 国内（ModelScope）/ 国外（Hugging Face、GitHub）。 */
export type LocalModelDownloadSource = 'auto' | 'domestic' | 'global'

export const LOCAL_MODEL_DOWNLOAD_SOURCES: readonly LocalModelDownloadSource[] = ['auto', 'domestic', 'global']

export interface LocalizedText {
  zh: string
  en: string
}

export interface LocalModelProgress {
  receivedBytes: number
  totalBytes: number
}

/** 上一次下载失败的原因（给界面换成用户语言）。 */
export type LocalModelFailureCode = 'network' | 'checksum' | 'disk' | 'cancelled' | 'unavailable'

export interface LocalModelInfo {
  id: LocalModelId
  title: LocalizedText
  purpose: LocalizedText
  /** 许可证简称（SPDX），如 MIT、Apache-2.0、GPL-3.0。 */
  license: string
  /** 全部文件合计大小（字节）。 */
  sizeBytes: number
  status: LocalModelStatus
  /** 仅 `downloading` 时有值。 */
  progress: LocalModelProgress | null
  /** 本次运行内最近一次下载失败的原因；成功或重新开始后清空。 */
  lastFailure: LocalModelFailureCode | null
}

/** 全部本地模型的当前状态与下载源设置。 */
export interface LocalModelsState {
  /** 每次模型状态或下载源变化时加一；只用于助手写入的并发核对，不展示给用户。 */
  revision: number
  downloadSource: LocalModelDownloadSource
  models: LocalModelInfo[]
}

export interface LocalModelProgressEvent {
  id: LocalModelId
  status: LocalModelStatus
  progress: LocalModelProgress | null
  lastFailure: LocalModelFailureCode | null
}

export interface LocalModelFileLocation {
  name: string
  /** 文件在模型里的作用，如 `model`。 */
  role: string
  /** 本机绝对路径；交给 fetch / Worker 前先过 `toFetchableMediaUrl()`。 */
  path: string
}

export interface LocalModelEnsureResult {
  id: LocalModelId
  directory: string
  files: LocalModelFileLocation[]
}

/** 失败原因（错误对象的 name 为 `LocalModelError`，message 以 `<code>:` 开头）。 */
export function readLocalModelFailureCode(error: unknown): LocalModelFailureCode | null {
  if (!(error instanceof Error)) return null
  const match = /^(network|checksum|disk|cancelled|unavailable):/.exec(error.message)
  return match ? match[1] as LocalModelFailureCode : null
}

export const LOCAL_MODELS_IPC_CHANNELS = {
  getState: 'localModels:getState',
  ensure: 'localModels:ensure',
  cancel: 'localModels:cancel',
  remove: 'localModels:remove',
  openFolder: 'localModels:openFolder',
  getDownloadSource: 'localModels:getDownloadSource',
  setDownloadSource: 'localModels:setDownloadSource',
  progress: 'localModels:progress',
} as const

export interface LocalModelsPlatform {
  getState(): Promise<LocalModelsState>
  /** 已就绪直接返回位置；否则下载并校验（同一模型并发调用共用一次下载）。 */
  ensure(id: LocalModelId): Promise<LocalModelEnsureResult>
  /** 取消进行中的下载；已下载的部分保留，下次继续。返回是否有可取消的下载。 */
  cancel(id: LocalModelId): Promise<boolean>
  /** 删除本地文件；正在下载时先取消。 */
  remove(id: LocalModelId): Promise<void>
  /** 在文件管理器中打开模型文件夹（不存在时打开“模型”总文件夹）。 */
  openFolder(id: LocalModelId | null): Promise<void>
  getDownloadSource(): Promise<LocalModelDownloadSource>
  setDownloadSource(source: LocalModelDownloadSource): Promise<void>
  /** 任一窗口或助手触发的下载都会推送给所有窗口。 */
  onProgress(handler: (event: LocalModelProgressEvent) => void): () => void
}
