/*
 * 文档底座的共享类型（存储底座 2.2）：主进程文档仓库、渲染层平台接口与后续文档会话共用。
 *
 * 三个概念（实施方案 2.2）：
 * - 文档：剪辑、画布、口播、镜头参考、图片文档。一份文档一个文件，带稳定 ID。
 * - 项目：装文档和素材的文件夹（“总项目”），项目名就是文件夹名。
 * - 素材：图片、视频、音频等文件。
 *
 * 所有时间在接口里都是毫秒时间戳；文档文件与项目说明里存 ISO 8601 字符串。
 * 所有路径在接口里都是绝对路径（内存形态），相对写法只出现在磁盘与数据库里。
 */

export const DOCUMENT_KIND_IDS = ['video_edit', 'canvas', 'audio_edit', 'camera_stage', 'image_document'] as const
export type DocumentKindId = (typeof DOCUMENT_KIND_IDS)[number]

export function isDocumentKindId(value: unknown): value is DocumentKindId {
  return typeof value === 'string' && (DOCUMENT_KIND_IDS as readonly string[]).includes(value)
}

/** 文件夹语言：作品目录首次创建时确定，项目创建时记进项目说明。 */
export type FolderLocale = 'zh' | 'en'

/** 文档所在容器：作品目录（不属于任何项目）或某个项目。 */
export type DocumentContainerRef = { kind: 'user' } | { kind: 'project'; projectId: string }

/** 跨文档引用：先按位置找（拷贝出来的项目引用自己的副本），找不到再按 ID 查索引。 */
export interface DocumentLink {
  docId: string
  /** 被引用文档文件的绝对路径（内存形态；保存时随整份内容一起换算）。 */
  path: string
}

/** 各类型自定义的列表摘要（如节点数），只放可直接显示的简单值。 */
export type DocumentListSummary = Record<string, string | number | boolean | null>

/** 定位一份文档：path 可选，给了就先按位置找并核对 ID，找不到再按 ID 查索引。 */
export interface DocumentTarget {
  id: string
  path?: string
}

export interface DocumentMeta {
  id: string
  kind: DocumentKindId
  name: string
  /** 文档文件的绝对路径。 */
  path: string
  container: DocumentContainerRef
  draft: boolean
  revision: number
  kindVersion: number
  createdAt: number
  updatedAt: number
}

export interface DocumentSummary extends DocumentMeta {
  /** 所在项目的名称（文件夹名）；独立文档为 null。 */
  projectName: string | null
  /** 位于作品目录之外（登记过的外部位置）。 */
  external: boolean
  /** 文件找不到（被删除、移走或外部位置所在的盘不在）。 */
  missing: boolean
  fileModifiedAt: number
  sizeBytes: number
  /** 通用封面（程序目录，按文档 ID 存）；没有时为 null。 */
  coverPath: string | null
  summary: DocumentListSummary
}

export interface DocumentUnresolvedLocation {
  /** 原样保留的存储值。 */
  value: string
  reason: 'unknown_project' | 'no_container' | 'invalid'
  projectId?: string
}

export interface DocumentReadResult {
  meta: DocumentMeta
  /** 内存形态的内容：所有位置都已换回绝对路径。 */
  content: unknown
  /** 引用到但磁盘上找不到的文件（绝对路径）。 */
  missingPaths: string[]
  /** 引用到的外部文件所在目录（已授权媒体协议读取）。 */
  externalDirectories: string[]
  /** 无法解析的位置（项目不在、写法损坏），原样保留在内容里。 */
  unresolved: DocumentUnresolvedLocation[]
}

export interface DocumentSaveResult {
  meta: DocumentMeta
  /** 内容与磁盘一致时不写文件，revision 不变。 */
  unchanged: boolean
}

export interface DocumentTransferResult {
  meta: DocumentMeta
  /** 从原容器复制进新容器的素材数量。 */
  copiedFiles: number
  /** 引用到但找不到、因此没能复制的文件。 */
  missingPaths: string[]
}

/** 同名时的处理：报错（用户输入的名字），或“两个都保留”自动加序号。 */
export type NameConflictPolicy = 'fail' | 'keepBoth'

export interface ProjectSummary {
  id: string
  /** 项目名就是文件夹名。 */
  name: string
  /** 项目文件夹的绝对路径。 */
  path: string
  locale: FolderLocale
  folders: { generated: string; materials: string }
  draft: boolean
  /** 位于作品目录之外（登记过的外部位置）。 */
  external: boolean
  missing: boolean
  createdAt: number
  mainVideoEditId: string | null
  documentCount: number
}

export type DocumentContainerFilter = { kind: 'any' } | DocumentContainerRef

export interface DocumentListQuery {
  kind?: DocumentKindId
  /** 默认全部。 */
  container?: DocumentContainerFilter
  /** 默认 true：草稿也列出（列表可放进草稿区）。 */
  includeDrafts?: boolean
  /** 默认 true：找不到的文件也列出（卡片显示“文件不存在”）。 */
  includeMissing?: boolean
}

export interface ProjectListQuery {
  includeDrafts?: boolean
  includeMissing?: boolean
}

export interface CreateDocumentRequest {
  kind: DocumentKindId
  container: DocumentContainerRef
  /** 省略时用类型的空内容。 */
  content?: unknown
  /** 省略时为草稿并自动起名“未命名画布 N”；给了名字就按用户输入处理（重名报错）。 */
  name?: string
  /** 默认：没给名字时为 true，给了名字时为 false。 */
  draft?: boolean
  /**
   * 沿用给定的文档 ID（导入、恢复与自动化造数据时保留原 ID，跨文档引用与外部引用照旧可用）；
   * 省略时生成新 ID。作品索引里已有同 ID 的文档时报 DocumentLocationError。
   */
  id?: string
}

export interface SaveDocumentRequest {
  target: DocumentTarget
  /** 写入前核对磁盘上的版本；不一致时报 DocumentRevisionConflictError。 */
  expectedRevision: number
  content: unknown
  /** 用户选择“覆盖”时跳过版本核对。 */
  force?: boolean
}

export interface RenameDocumentRequest {
  target: DocumentTarget
  name: string
}

export interface FinalizeDocumentRequest {
  target: DocumentTarget
  name: string
  /** 另选的保存位置（目标文件夹）；省略时留在原文件夹。 */
  folder?: string
}

export interface MoveDocumentRequest {
  target: DocumentTarget
  container: DocumentContainerRef
  onConflict?: NameConflictPolicy
}

export interface DuplicateDocumentRequest {
  target: DocumentTarget
  /** 省略时沿用原名（同一文件夹里必然重名，需配合 keepBoth）。 */
  name?: string
  onConflict?: NameConflictPolicy
}

export type NameCheckSubject = { type: 'project' } | { type: 'document'; kind: DocumentKindId }

/**
 * 查重位置：
 * - container：该类型在容器里的默认位置（项目 → `项目/`；文档 → 项目文件夹或类型文件夹）。
 * - folder：另选的文件夹。
 * - renaming：改名时给出现有文件或项目文件夹，查它所在的文件夹并排除它自己。
 */
export type NameCheckLocation = { container: DocumentContainerRef } | { folder: string } | { renaming: string }

export interface NameCheckRequest {
  subject: NameCheckSubject
  name: string
  location: NameCheckLocation
}

export type EntryNameInvalidReason = 'empty' | 'too_long' | 'illegal_characters' | 'reserved'

export type NameCheckResult =
  | { status: 'available'; name: string; path: string }
  | { status: 'duplicate'; name: string; path: string; existingPath: string }
  | { status: 'invalid'; reason: EntryNameInvalidReason | 'location'; message: string }

export interface CreateProjectRequest {
  /** 省略时为草稿并自动起名“未命名项目 N”。 */
  name?: string
  draft?: boolean
}

export interface RenameProjectRequest {
  projectId: string
  name: string
}

export interface SetProjectMainDocumentRequest {
  projectId: string
  /** 项目里的一份剪辑；null 表示清除（项目没有主剪辑）。 */
  documentId: string | null
}

/** 复制进容器的哪个固定子文件夹：生成结果，或素材（作品目录为“上传素材”）。 */
export type ContainerFileFolder = 'generated' | 'materials'

export interface ImportFileRequest {
  container: DocumentContainerRef
  /** 要复制进来的文件（绝对路径）。已在容器里的文件原样返回、不复制。 */
  sourcePath: string
  folder: ContainerFileFolder
}

export interface ImportFileResult {
  /** 容器里的位置（绝对路径）。 */
  path: string
  /** 真的复制了；同名且内容相同时复用已有文件，为 false。 */
  copied: boolean
}

export interface FinalizeProjectRequest {
  projectId: string
  name: string
  /** 另选的父文件夹：整个项目文件夹移过去并登记为外部位置。 */
  parentFolder?: string
}

export type DocumentLinkResolution =
  | { status: 'found'; meta: DocumentMeta; via: 'path' | 'id' }
  | { status: 'missing' }

export interface DocumentCoverSource {
  /** 任意媒体形态：本地路径 / file:// / henji-media:// / http(s) / data:。 */
  source: string
  sourceKind: 'image' | 'video'
}

export interface SaveDocumentCoverRequest {
  docId: string
  /** 1 张原图；2/3 张取前 2 张左右拼接；4 张按 2×2 拼接。 */
  sources: DocumentCoverSource[]
}

export interface DocumentCoverResult {
  docId: string
  coverPath: string | null
}

export interface DocumentIndexScanReport {
  startedAt: number
  durationMs: number
  projects: number
  documents: number
  /** 本次重新读取了文件头的文档数（新增或修改时间 / 大小变化）。 */
  readDocuments: number
  /** 拷贝出来的副本换了新 ID 的文档与项目数。 */
  reassignedIds: number
  /** 识别为移动（ID 不变、位置变化）的文档数。 */
  moved: number
  /** 本次标为缺失的条目数。 */
  missing: number
  /** 无法识别的文件（格式损坏、类型未登记、版本过新）。 */
  invalid: number
}
