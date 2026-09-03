import type { ImageEditDocumentV3 } from '../../core/imageEdit/v3/documentTypes'
import type { ImageEditCommandHistorySnapshotV3 } from '../../core/imageEdit/v3/commandHistoryCodec'

export type ImageEditorV3DocumentRef = `image-edit-v3:${string}`
export type ImageEditorV3ResourceRef = `sha256:${string}`
export type ImageEditorV3OutputRef = `henjiimg:${string}@${number}`
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

export interface ImageEditorV3PackageReadyResult {
  kind: 'ready'
  snapshot: ImageEditorV3DocumentSnapshot
  resources: ImageEditorV3ResourceDescriptor[]
  thumbnail: ImageEditorV3PackageThumbnail | null
}

export interface ImageEditorV3MissingExternalSource {
  resourceRef: ImageEditorV3ResourceRef
  fingerprint: { algorithm: 'sha256'; value: string }
  byteLength: number | null
  mediaType: string | null
  pathHint: string | null
  relinkHint: string | null
}

export interface ImageEditorV3PackageRelinkRequiredResult {
  kind: 'relink-required'
  /** 仅当前主渲染进程短期有效；不包含包路径或文件系统路径。 */
  pendingPackageRef: `image-edit-package-open:${string}`
  missingExternalSources: ImageEditorV3MissingExternalSource[]
  thumbnail: ImageEditorV3PackageThumbnail | null
}

export type ImageEditorV3PackageOpenResult =
  | ImageEditorV3PackageReadyResult
  | ImageEditorV3PackageRelinkRequiredResult

export interface ImageEditorV3PackageSaveResult {
  outputRef: ImageEditorV3OutputRef
  documentRef: ImageEditorV3DocumentRef
  revision: number
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
  openPackage(request: {
    requestId: string
  }): Promise<ImageEditorV3DialogResult<ImageEditorV3PackageOpenResult>>
  relinkPackageExternalSource(request: {
    requestId: string
    pendingPackageRef: `image-edit-package-open:${string}`
    resourceRef: ImageEditorV3ResourceRef
  }): Promise<ImageEditorV3DialogResult<ImageEditorV3PackageOpenResult>>
  savePackageAs(request: {
    requestId: string
    documentRef: ImageEditorV3DocumentRef
    revision: number
    suggestedName?: string
    /** 当前已合成预览的有界副本；不接收 Data URL 或完整文档像素。 */
    thumbnail?: ImageEditorV3PackageThumbnail & { extension: 'png' | 'webp' }
  }): Promise<ImageEditorV3DialogResult<ImageEditorV3PackageSaveResult>>
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
