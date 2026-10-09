import type { ImageEditDocumentV3 } from '../../core/imageEdit/v3/documentTypes'
import type { ImageEditCommandHistorySnapshotV3 } from '../../core/imageEdit/v3/commandHistoryCodec'
import type { DocumentContainerRef, DocumentMeta, DocumentReadResult } from '../../core/documents/types'

export type ImageEditorV3DocumentRef = `image-edit-v3:${string}`
export type ImageEditorV3ResourceRef = `sha256:${string}`
export type ImageEditorV3RasterOutputRef = `image-export-v3:${string}@${number}:${ImageEditorV3RasterExportFormat}`

/**
 * 当前 FFmpeg HDR AVIF 编码器的真实内存门槛；渲染层 readiness 与主进程 admission
 * 必须共用此值，直到有界 AVIF grid 编码替代整帧编码器。
 */
export const IMAGE_EDITOR_V3_HDR_AVIF_MAX_PIXELS = 9_000_000
export const IMAGE_EDITOR_V3_PACKAGE_THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024

export interface ImageEditorV3DocumentReference {
  documentRef: ImageEditorV3DocumentRef
  revision: number
  previewRef: ImageEditorV3ResourceRef | null
}

export interface ImageEditorV3DocumentSnapshot extends ImageEditorV3DocumentReference {
  document: ImageEditDocumentV3
  history: ImageEditCommandHistorySnapshotV3 | null
  resourceRefs: ImageEditorV3ResourceRef[]
  /** 当前快照引用资源的权威大小；稀疏瓦片读取不得依赖渲染层猜测。 */
  resources: ImageEditorV3ResourceDescriptor[]
  /** 主进程对 documentId/revision/document/resourceRefs 计算的不可变导出快照指纹。 */
  sourceFingerprint: `sha256:${string}`
}

export interface ImageEditorV3ResourceDescriptor {
  resourceRef: ImageEditorV3ResourceRef
  byteLength: number
  mediaType: string | null
}

export interface ImageEditorV3SourceMetadata {
  resourceRef: ImageEditorV3ResourceRef
  /** 应用 EXIF 方向后的逻辑尺寸。 */
  width: number
  height: number
  /** 编码文件中的原始像素尺寸。 */
  encodedWidth: number
  encodedHeight: number
  format: string | null
  channels: number | null
  depth: string | null
  bitsPerSample: number
  colorSpace: string | null
  orientation: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
  orientationApplied: true
  density: number | null
  pages: number | null
  hasAlpha: boolean
  hasIccProfile: boolean
  iccProfileResourceRef: ImageEditorV3ResourceRef | null
  cicp: {
    colorPrimaries: number
    transferCharacteristics: number
    matrixCoefficients: number
    fullRange: boolean
  } | null
  hdr: boolean
}

export type ImageEditorV3SourceLocator =
  | { kind: 'local-path'; filePath: string }
  | { kind: 'http-url'; url: string }
  | { kind: 'data-url'; dataUrl: string }

export interface ImageEditorV3ManagedSource {
  resource: ImageEditorV3ResourceDescriptor
  metadata: ImageEditorV3SourceMetadata
  /** 受管源的能力 URL；宿主可在导入完成后释放原始 Data URL/远程 URL。 */
  mediaUrl: string
}

export interface ImageEditorV3PyramidDescriptor {
  tileSize: 512
  levels: Array<{
    mip: number
    width: number
    height: number
    columns: number
    rows: number
  }>
}

export interface ImageEditorV3PyramidPrewarmResult {
  plannedTiles: number
  completedTiles: number
  truncated: boolean
}

export interface ImageEditorV3FastProxy {
  resourceRef: ImageEditorV3ResourceRef
  width: number
  height: number
  mediaType: 'image/webp'
  bytes: ArrayBuffer
}

export interface ImageEditorV3SourceTile {
  resourceRef: ImageEditorV3ResourceRef
  mip: number
  tileX: number
  tileY: number
  halo: number
  width: number
  height: number
  channels: 4
  bitDepth: 8 | 16 | 32
  sampleFormat: 'uint' | 'float'
  numericRange: 'unorm8' | 'unorm16' | 'scene-linear'
  byteOrder: 'little-endian'
  rowStride: number
  colorSpace: 'srgb' | 'scrgb'
  transferFunction: 'srgb' | 'linear'
  alphaMode: 'straight'
  orientationApplied: true
  originX: number
  originY: number
  /** 精确长度、紧密排列的 RGBA 像素；长度恒为 width * height * 4 * bitDepth / 8。 */
  pixels: ArrayBuffer
}

export interface ImageEditorV3SourceTileBatchItem {
  resourceRef: ImageEditorV3ResourceRef
  mip: number
  tileX: number
  tileY: number
  halo?: number
  bitDepth?: 8 | 16 | 32
  /** 数值越小越优先；同优先级保持输入顺序。 */
  priority: number
}

export interface ImageEditorV3SourceTileBatchProgress {
  index: number
  tile: ImageEditorV3SourceTile
}

export type ImageEditorV3SourceTileStreamEvent =
  | { type: 'tile'; index: number; tile: ImageEditorV3SourceTile }
  | { type: 'complete'; tileCount: number }
  | { type: 'error'; name: string; message: string }

export interface ImageEditorV3SourceTileStreamCredit {
  type: 'credit'
  count: number
}

export interface ImageEditorV3BrushRgbaTile {
  storage: 'rgba-float32'
  width: number
  height: number
  /** IPC 只接受精确长度的 ArrayBuffer 或无偏移、无额外 backing bytes 的 Float32Array。 */
  data: ArrayBuffer | Float32Array
  colorDomain: 'source-encoded' | 'linear-light' | 'perceptual-working'
  workingSpace: 'srgb' | 'display-p3' | 'rec2020'
  transferFunction: 'srgb' | 'linear' | 'pq' | 'hlg'
  referenceWhiteNits: number
  alpha: 'premultiplied'
}

export interface ImageEditorV3BrushMaskTile {
  storage: 'mask-float32'
  width: number
  height: number
  data: ArrayBuffer | Float32Array
}

export type ImageEditorV3BrushTile = ImageEditorV3BrushRgbaTile | ImageEditorV3BrushMaskTile

export interface ImageEditorV3BrushTileResource {
  resourceRef: ImageEditorV3ResourceRef
  byteSize: number
}

export interface ImageEditorV3PersistedBrushTile {
  tileKey: string
  resource: ImageEditorV3BrushTileResource
}

export interface ImageEditorV3LoadedBrushTile {
  tileKey: string
  /** 主进程返回的数据始终为独占、精确长度的 ArrayBuffer。 */
  tile: ImageEditorV3BrushTile & { data: ArrayBuffer }
}

export type ImageEditorV3DialogResult<T> =
  | { status: 'cancelled' }
  | { status: 'completed'; value: T }

export interface ImageEditorV3PackageThumbnail {
  bytes: ArrayBuffer
  mediaType: 'image/png' | 'image/webp'
}

/** 图片文档（.henjiimg，3.5）的位置：给了 path 先按位置找并核对 ID，找不到再按作品索引。 */
export interface ImageEditorV3ImageDocumentTarget {
  id: string
  path?: string
}

/** 打开图片文档后编辑器要载入的工作副本（程序目录 V3 文档仓库里同 ID 的文档）。 */
export interface ImageEditorV3ImageDocumentWorking {
  documentRef: ImageEditorV3DocumentRef
  revision: number
  previewRef: ImageEditorV3ResourceRef | null
  /** 底层原图的受管媒体地址（内容哈希能力 URL，不含路径）。 */
  sourceUrl: string | null
}

export interface ImageEditorV3ImageDocumentReady {
  status: 'ready'
  read: DocumentReadResult
  working: ImageEditorV3ImageDocumentWorking
  /** 这次按文件重新解包；渲染层若还留着这份文档的旧实例要先丢弃。 */
  imported: boolean
}

/** 工作副本里有没写回的修改（上次意外退出），等用户选择恢复或使用文件里的版本。 */
export interface ImageEditorV3ImageDocumentRecoveryRequired {
  status: 'recovery'
  meta: DocumentMeta
  workingSavedAt: number
  fileSavedAt: number
}

export type ImageEditorV3ImageDocumentOpenResult =
  | ImageEditorV3ImageDocumentReady
  | ImageEditorV3ImageDocumentRecoveryRequired

export interface ImageEditorV3ImageDocumentCommitResult {
  meta: DocumentMeta
  /** 工作副本与文件一致，没有写文件。 */
  unchanged: boolean
}

/** 画布多图层节点的内嵌图片文档（3.4）：打开画布时的准备结果。 */
export interface ImageEditorV3CanvasLayersPrepareResult {
  /** 画布副本分出的新文档：旧文档 ID → 新文档 ID（节点要改指向新的）。 */
  rewrites: Record<string, string>
  /** 既没有工作副本也找不到包的文档 ID。 */
  missing: string[]
}

/** 画布写回时写出内嵌图片文档包的结果。 */
export interface ImageEditorV3CanvasLayersCommitResult {
  /** 文档 ID → 包所在位置（画布所在容器的 `.henji/canvas-layers/`）。 */
  packages: Record<string, string>
  written: number
  /** 本次清理掉的不再用的内嵌文档数。 */
  released: number
}

export type ImageEditorV3RasterExportFormat =
  | 'bigtiff'
  | 'jpeg'
  | 'webp'
  | 'png8'
  | 'png16'
  | 'tiff8'
  | 'tiff16'
  /** SDR 高位深，或严格 Rec.2020 CICP 的 PQ/HLG HDR AVIF。 */
  | 'avif10'
  | 'avif12'

export interface ImageEditorV3RasterExportDescription {
  width: number
  height: number
  bitDepth: 8 | 16 | 32
  sampleFormat: 'uint' | 'float'
  colorSpace: 'srgb' | 'display-p3' | 'rec2020'
  transferFunction: 'srgb' | 'linear' | 'pq' | 'hlg'
  alphaMode: 'straight' | 'premultiplied'
  iccProfileResourceRef?: ImageEditorV3ResourceRef | null
  cicp?: ImageEditorV3SourceMetadata['cicp']
  hdrMetadata?: {
    maxLuminanceNits?: number
    minLuminanceNits?: number
    maxContentLightLevelNits?: number
    maxFrameAverageLightLevelNits?: number
  } | null
}

export interface ImageEditorV3RasterExportStartResult {
  sessionId: string
  documentRef: ImageEditorV3DocumentRef
  revision: number
  sourceFingerprint: `sha256:${string}`
  format: ImageEditorV3RasterExportFormat
}

export interface ImageEditorV3RasterExportResult {
  outputRef: ImageEditorV3RasterOutputRef
  documentRef: ImageEditorV3DocumentRef
  revision: number
  sourceFingerprint: `sha256:${string}`
  format: ImageEditorV3RasterExportFormat
  width: number
  height: number
}

export interface ImageEditorV3ManagedRasterExportResult extends ImageEditorV3RasterExportResult {
  publication: 'document-preview'
  /** 已原子挂到同 revision 文档上的内容寻址预览资源。 */
  previewRef: ImageEditorV3ResourceRef
  /** 不包含本地路径的受管媒体能力 URL，可直接用于展示和后续媒体消费。 */
  mediaUrl: string
}

export interface ImageEditorV3StandaloneRasterExportResult extends ImageEditorV3RasterExportResult {
  publication: 'standalone-image'
  /** 已转存到普通画布图片使用的受管路径，不会改写 V3 文档预览。 */
  imagePath: string
  /** 画布事务未接管时可补偿释放的本次新建资源。 */
  createdFilePaths: string[]
}

export type ImageEditorV3RasterPublication = 'document-preview' | 'standalone-image'

export interface ImageEditorV3Platform {
  /** 有界 SDR 工作块；所有路径和临时文件只在宿主内解析。 */
  selectRasterRegion?(request: ImageEditorV3SubjectRequest): Promise<ImageEditorV3SubjectResult>
  repairRaster?(request: ImageEditorV3RepairRequest): Promise<{ patch: ImageEditorV3ResourceDescriptor; durationMs: number }>
  readRepairProgress?(request: { requestId: string }): Promise<ImageEditorV3RepairProgress | null>
  pinRepairResources?(request: { requestId: string; resourceRefs: ImageEditorV3ResourceRef[] }): Promise<void>
  releaseRepairResources?(request: { requestId: string }): Promise<void>
  listDocuments(request: {
    requestId: string
    cursor?: string
    limit?: number
  }): Promise<{ documentRefs: ImageEditorV3DocumentRef[]; nextCursor: string | null }>
  loadDocument(request: {
    requestId: string
    documentRef: ImageEditorV3DocumentRef
  }): Promise<ImageEditorV3DocumentSnapshot | null>
  saveDocument(request: {
    requestId: string
    document: ImageEditDocumentV3
    expectedRevision: number
    history?: ImageEditCommandHistorySnapshotV3 | null
    resourceRefs: ImageEditorV3ResourceRef[]
    previewRef?: ImageEditorV3ResourceRef | null
  }): Promise<ImageEditorV3DocumentReference>
  /** 仅用于跨存储事务补偿；revision 已变化时拒绝删除。 */
  deleteDocumentIfRevision(request: {
    requestId: string
    documentRef: ImageEditorV3DocumentRef
    expectedRevision: number
  }): Promise<{ deleted: boolean }>
  /** 精确版本 fork；新文档拥有独立历史头，内容寻址资源可安全复用。 */
  forkDocument(request: {
    requestId: string
    sourceDocumentRef: ImageEditorV3DocumentRef
    expectedRevision: number
    targetDocumentRef: ImageEditorV3DocumentRef
  }): Promise<ImageEditorV3DocumentReference>
  importColorLut?(request: { requestId: string }): Promise<ImageEditorV3DialogResult<{ resourceRef: ImageEditorV3ResourceRef; name: string }>>
  importSource(request: {
    requestId: string
  }): Promise<ImageEditorV3DialogResult<ImageEditorV3ManagedSource>>
  /** 将宿主已有的路径/URL/Data URL 导入受管资源；返回值永不包含文件系统路径。 */
  ingestSource(request: {
    requestId: string
    source: ImageEditorV3SourceLocator
  }): Promise<ImageEditorV3ManagedSource>
  readSourceMetadata(request: {
    requestId: string
    resourceRef: ImageEditorV3ResourceRef
  }): Promise<ImageEditorV3SourceMetadata>
  describeSourcePyramid(request: {
    requestId: string
    resourceRef: ImageEditorV3ResourceRef
  }): Promise<ImageEditorV3PyramidDescriptor>
  prewarmSourcePyramid(request: {
    requestId: string
    resourceRef: ImageEditorV3ResourceRef
    minimumMip?: number
    maximumMip?: number
    tileBudget?: number
    bitDepth?: 8 | 16 | 32
  }): Promise<ImageEditorV3PyramidPrewarmResult>
  readFastProxy(request: {
    requestId: string
    resourceRef: ImageEditorV3ResourceRef
    maxDimension: number
  }): Promise<ImageEditorV3FastProxy>
  readSourceTile(request: {
    requestId: string
    resourceRef: ImageEditorV3ResourceRef
    mip: number
    tileX: number
    tileY: number
    halo?: number
    bitDepth?: 8 | 16 | 32
  }): Promise<ImageEditorV3SourceTile>
  /** 交互显示专用有界批次；宿主按 priority 调度，结果仍按输入顺序返回。 */
  readSourceTiles?(request: {
    requestId: string
    tiles: ImageEditorV3SourceTileBatchItem[]
    /** 仅存在于渲染层 PAL；preload 不会把函数发送到主进程。 */
    onTile?(progress: ImageEditorV3SourceTileBatchProgress): void
  }): Promise<{ tiles: ImageEditorV3SourceTile[] }>
  persistBrushTiles(request: {
    requestId: string
    tiles: Array<{ tileKey: string; tile: ImageEditorV3BrushTile }>
  }): Promise<{ tiles: ImageEditorV3PersistedBrushTile[] }>
  readBrushTiles(request: {
    requestId: string
    tiles: Array<{ tileKey: string; resource: ImageEditorV3BrushTileResource }>
  }): Promise<{ tiles: ImageEditorV3LoadedBrushTile[] }>
  /**
   * 打开图片文档：按需把 .henjiimg 解到程序目录的工作副本。recovery 为 ask 且工作副本有没写回的修改时
   * 返回 recovery，由界面询问后带着 restore（用工作副本）或 discard（用文件里的版本）再打开。
   */
  openImageDocument(request: {
    requestId: string
    target: ImageEditorV3ImageDocumentTarget
    recovery: 'ask' | 'restore' | 'discard'
  }): Promise<ImageEditorV3ImageDocumentOpenResult>
  /** 改名、移动、转正后重新定位，只描述工作副本，不重新解包。 */
  describeImageDocument(request: {
    requestId: string
    target: ImageEditorV3ImageDocumentTarget
  }): Promise<ImageEditorV3ImageDocumentReady>
  /** 新建草稿：工作副本已按 documentId 保存，写出草稿包到它最终所在的文件夹。 */
  createImageDocument(request: {
    requestId: string
    documentId: string
    container: DocumentContainerRef
    emptyUntilRevision: number | null
  }): Promise<ImageEditorV3ImageDocumentReady>
  /** 写回：把工作副本原子写进 .henjiimg；文件版本与 expectedRevision 不一致时报冲突，force 覆盖。 */
  commitImageDocument(request: {
    requestId: string
    target: ImageEditorV3ImageDocumentTarget
    expectedRevision: number
    force?: boolean
    /** 当前已合成预览的有界副本，作为包内缩略图与列表封面；不接收 Data URL 或完整文档像素。 */
    thumbnail?: ImageEditorV3PackageThumbnail & { extension: 'png' | 'webp' }
  }): Promise<ImageEditorV3ImageDocumentCommitResult>
  /**
   * 打开画布时准备多图层节点的内嵌图片文档：本机没有工作副本时按包解出；工作副本属于别的画布
   * （创建副本、拷贝文件夹）时分出新文档并返回改指向关系。
   */
  prepareCanvasLayers(request: {
    requestId: string
    canvasId: string
    layers: Array<{ documentId: string; packagePath?: string }>
  }): Promise<ImageEditorV3CanvasLayersPrepareResult>
  /**
   * 画布写回时把内嵌图片文档写成画布所在容器 `.henji/canvas-layers/` 里的包；已是最新的不写。
   * 带上 retainedDocumentIds（当前节点 + 撤销记录仍在用的）时，顺带清理属于这份画布、不再用、
   * 也没有别的画布提到的内嵌文档（包与本机工作副本）。
   */
  commitCanvasLayers(request: {
    requestId: string
    canvasId: string
    container: DocumentContainerRef
    documentIds: string[]
    retainedDocumentIds?: string[]
  }): Promise<ImageEditorV3CanvasLayersCommitResult>
  /** 保存位置只由主进程原生对话框产生，渲染层不能注入输出路径。 */
  startRasterExport(request: {
    requestId: string
    documentRef: ImageEditorV3DocumentRef
    revision: number
    sourceFingerprint: `sha256:${string}`
    format: ImageEditorV3RasterExportFormat
    description: ImageEditorV3RasterExportDescription
    suggestedName?: string
    tileSize?: number
    compressionLevel?: number
    quality?: number
    effort?: number
  }): Promise<ImageEditorV3DialogResult<ImageEditorV3RasterExportStartResult>>
  /** 不弹保存框；主进程选择受管暂存目标并在完成后发布内容寻址结果。 */
  startManagedRasterExport(request: {
    requestId: string
    documentRef: ImageEditorV3DocumentRef
    revision: number
    sourceFingerprint: `sha256:${string}`
    format: ImageEditorV3RasterExportFormat
    description: ImageEditorV3RasterExportDescription
    tileSize?: number
    compressionLevel?: number
    quality?: number
    effort?: number
    /** 默认挂到当前文档预览；独立导出必须显式使用 standalone-image。 */
    publication?: ImageEditorV3RasterPublication
  }): Promise<ImageEditorV3RasterExportStartResult>
  writeRasterExportTile(request: {
    sessionId: string
    tile: {
      x: number
      y: number
      width: number
      height: number
      rowStride: number
      pixels: ArrayBuffer
    }
  }): Promise<{ written: true }>
  /** 原子丢弃当前 staged 输出，并以相同目标和权威快照创建全新编码会话。 */
  restartRasterExport(request: {
    sessionId: string
  }): Promise<ImageEditorV3RasterExportStartResult>
  completeRasterExport(request: {
    sessionId: string
  }): Promise<ImageEditorV3RasterExportResult>
  completeManagedRasterExport(request: {
    sessionId: string
  }): Promise<ImageEditorV3ManagedRasterExportResult | ImageEditorV3StandaloneRasterExportResult>
  cancelRasterExport(request: {
    sessionId: string
  }): Promise<{ cancelled: boolean }>
  collectGarbage(request: {
    requestId: string
    retainedResourceRefs: ImageEditorV3ResourceRef[]
  }): Promise<{ deletedResourceRefs: ImageEditorV3ResourceRef[]; reclaimedBytes: number }>
  cancelRequest(requestId: string): Promise<{ cancelled: boolean }>
}

export interface ImageEditorV3RepairRequest {
  requestId: string
  leaseId: string
  width: number
  height: number
  rgba: ArrayBuffer
  mask: ArrayBuffer
  sample?: ArrayBuffer
  quality: 'fast' | 'fine' | 'blemish'
}
export interface ImageEditorV3RepairProgress { stage: 'resolving' | 'downloading' | 'processing' | 'publishing'; done: number; total: number }

export interface ImageEditorV3SubjectRequest {
  requestId: string
  width: number
  height: number
  rgba: ArrayBuffer
  region: import('../../core/imageEdit/v3/subjectSelection').ImageEditSubjectRegionV3
}
export interface ImageEditorV3SubjectCandidate {
  id: string
  mask: import('../../core/imageEdit/v3/subjectSelection').ImageEditSelectionMaskShapeV3
  score: number
  area: number
  bounds: { x: number; y: number; width: number; height: number }
}
export interface ImageEditorV3SubjectResult {
  candidates: ImageEditorV3SubjectCandidate[]
  model: 'efficienttam' | 'rvm' | 'selfie'
  providers: string[]
  inferenceMs: number
  durationMs: number
}
