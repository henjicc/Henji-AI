import type { SoundFeatures } from '../../core/soundLibrary/soundFeatures'

/*
 * 音效库：用户登记自己的音效文件夹，主进程递归扫描并在后台进程里测量每个音效（时长、起音点、击中点、
 * 响度、明暗；听音模型就绪时再算 CLAP 向量），按“路径 + 大小 + 修改时间”增量缓存。
 * 文件夹可直接按路径登记，不给路径时经主进程的系统文件夹选择框登记；之后按文件夹 ID 引用。
 * 主进程实现在 `electron/main/services/sound-library/`，渲染层经 `src/commands/soundLibrary.ts` 调用。
 */

export type SoundLibraryIndexStatus = 'not_indexed' | 'indexing' | 'ready' | 'failed'

export interface SoundLibrarySkippedFile {
  /** 相对登记文件夹的路径。 */
  relativePath: string
  /** 给用户看的原因（文件损坏、无法解码等）。 */
  reason: string
}

export interface SoundLibraryFolderInfo {
  id: string
  /** 文件夹名（不含上级路径）。 */
  name: string
  /** 本机绝对路径。 */
  path: string
  status: SoundLibraryIndexStatus
  soundCount: number
  /** 已算出听音向量的音效数。 */
  listeningCount: number
  skipped: SoundLibrarySkippedFile[]
  progress: { done: number; total: number } | null
  /** 最近一次整理完成的时间（ISO）；从未整理为 null。 */
  indexedAt: string | null
  /** 最近一次整理失败的原因；成功后清空。 */
  lastError: string | null
}

export interface SoundLibraryState {
  /** 文件夹登记或索引变化时加一；只用于助手写入的并发核对，不展示给用户。 */
  revision: number
  folders: SoundLibraryFolderInfo[]
  /** 听音模型（audio_understanding_clap）是否已下载可用。 */
  listeningModelReady: boolean
}

export interface SoundLibrarySearchRequest {
  /** 名字关键词，中英文均可，互为备选。 */
  keywords: string[]
  /** 给听音模型的英文描述（如 "a short sharp whoosh"）；模型未下载时只按名字。 */
  description?: string
  folderIds?: string[]
  minDurationSeconds?: number
  maxDurationSeconds?: number
  maxHitSeconds?: number
  brightness?: 'dark' | 'neutral' | 'bright'
  limit: number
}

export interface SoundLibraryMatch extends SoundFeatures {
  id: string
  folderId: string
  relativePath: string
  label: string
  english: string | null
  chinese: string | null
  score: number
  nameScore: number
  listenScore: number | null
  matchedBy: Array<'name' | 'listening'>
}

/**
 * - `used`：听音参与了排序
 * - `no_description`：没有给英文描述，只按名字
 * - `model_not_downloaded`：听音模型未下载，只按名字
 * - `partial`：部分音效还没有听音向量（例如刚下载模型），这部分只按名字
 */
export type SoundLibraryListeningUse = 'used' | 'no_description' | 'model_not_downloaded' | 'partial'

export interface SoundLibrarySearchResponse {
  matches: SoundLibraryMatch[]
  noGoodMatch: boolean
  considered: number
  listening: SoundLibraryListeningUse
  indexedSounds: number
  skippedFiles: number
}

export interface SoundLibrarySoundSummary {
  id: string
  folderId: string
  relativePath: string
  label: string
  english: string | null
  chinese: string | null
  features: SoundFeatures
  hasListening: boolean
}

export interface SoundLibrarySoundLocation extends SoundLibrarySoundSummary {
  /** 本机绝对路径：只在宿主内部组合（放进剪辑）时使用。 */
  path: string
}

export interface SoundLibrarySoundPage { sounds: SoundLibrarySoundSummary[]; total: number; revision: number }

export const SOUND_LIBRARY_IPC_CHANNELS = {
  getState: 'soundLibrary:getState',
  addFolder: 'soundLibrary:addFolder',
  removeFolder: 'soundLibrary:removeFolder',
  refresh: 'soundLibrary:refresh',
  search: 'soundLibrary:search',
  locate: 'soundLibrary:locate',
  listSounds: 'soundLibrary:listSounds',
  changed: 'soundLibrary:changed',
} as const

export interface SoundLibraryPlatform {
  getState(): Promise<SoundLibraryState>
  /** 打开系统文件夹选择框登记一个音效文件夹并开始整理；用户取消返回 null，已登记的返回原文件夹。 */
  /** 给了路径直接登记；不给时弹出系统选择框。 */
  addFolder(folderPath?: string): Promise<SoundLibraryFolderInfo | null>
  removeFolder(id: string): Promise<boolean>
  /** 增量整理指定文件夹（省略则全部），只分析新增或改动的文件；返回整理后的状态。 */
  refresh(folderIds?: string[]): Promise<SoundLibraryState>
  /** 先增量整理所涉文件夹，再检索。 */
  search(request: SoundLibrarySearchRequest): Promise<SoundLibrarySearchResponse>
  locate(soundId: string): Promise<SoundLibrarySoundLocation>
  /** 按相对路径排序分页列出已整理的音效（不含本机路径）；未整理的文件夹先整理。 */
  listSounds(offset: number, limit: number): Promise<SoundLibrarySoundPage>
  onChanged(handler: (state: SoundLibraryState) => void): () => void
}
