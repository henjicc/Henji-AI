import type { ImageEditDocumentV3 } from '../../core/imageEdit/v3/documentTypes'
import type { ImageEditCommandHistorySnapshotV3 } from '../../core/imageEdit/v3/commandHistoryCodec'

export type ImageEditorV3DocumentRef = `image-edit-v3:${string}`
export type ImageEditorV3ResourceRef = `sha256:${string}`
export type ImageEditorV3OutputRef = `henjiimg:${string}@${number}`
export type ImageEditorV3RasterOutputRef = `image-export-v3:${string}@${number}:${ImageEditorV3RasterExportFormat}`

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

export interface ImageEditorV3PackageOpenResult {
  snapshot: ImageEditorV3DocumentSnapshot
  resources: ImageEditorV3ResourceDescriptor[]
  thumbnail: { bytes: ArrayBuffer; mediaType: string } | null
}

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
  /** 当前仅支持高位深 SDR；PQ/HLG 会在主进程明确拒绝。 */
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
  /** 已原子挂到同 revision 文档上的内容寻址预览资源。 */
  previewRef: ImageEditorV3ResourceRef
  /** 不包含本地路径的受管媒体能力 URL，可直接用于展示和后续媒体消费。 */
  mediaUrl: string
}

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
  savePackageAs(request: {
    requestId: string
    documentRef: ImageEditorV3DocumentRef
    revision: number
    suggestedName?: string
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
  }): Promise<ImageEditorV3ManagedRasterExportResult>
  cancelRasterExport(request: {
    sessionId: string
  }): Promise<{ cancelled: boolean }>
  collectGarbage(request: {
    requestId: string
    retainedResourceRefs: ImageEditorV3ResourceRef[]
  }): Promise<{ deletedResourceRefs: ImageEditorV3ResourceRef[]; reclaimedBytes: number }>
  cancelRequest(requestId: string): Promise<{ cancelled: boolean }>
}
