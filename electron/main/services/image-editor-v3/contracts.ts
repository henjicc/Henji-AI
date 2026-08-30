import type { Readable } from 'node:stream'

export const IMAGE_EDIT_DOCUMENT_FORMAT = 'henji-image-edit' as const
export const IMAGE_EDIT_DOCUMENT_VERSION = 3 as const
export const IMAGE_EDIT_DOCUMENT_REF_PREFIX = 'image-edit-v3:' as const
export const IMAGE_EDIT_TILE_SIZE = 512 as const

export type ResourceId = `sha256:${string}`

/**
 * Electron 持久层暂不依赖渲染层正在演进的 V3 文档类型。document 会在核心层完成
 * schema 校验；这里负责版本、revision、资源边界与原子落盘，并原样往返未知字段。
 */
export interface ImageEditDocumentEnvelope {
  format: typeof IMAGE_EDIT_DOCUMENT_FORMAT
  formatVersion: typeof IMAGE_EDIT_DOCUMENT_VERSION
  documentId: string
  revision: number
  createdAt: string
  updatedAt: string
  document: unknown
  resourceRefs: ResourceId[]
  previewRef?: ResourceId
}

export interface ImageEditProjectReference {
  documentRef: string
  revision: number
  previewRef?: ResourceId
}

export interface ResourceDescriptor {
  id: ResourceId
  sha256: string
  byteLength: number
  mediaType?: string
}

export interface ResourceLease {
  readonly resourceIds: readonly ResourceId[]
  release(): Promise<void>
}

export interface SourceImageMetadata {
  resourceId: ResourceId
  width: number
  height: number
  format?: string
  channels?: number
  depth?: string
  /** 源编码的真实采样精度；10/12 位不得归一化成 16。 */
  bitsPerSample: number
  colorSpace?: string
  orientation?: number
  density?: number
  pages?: number
  hasAlpha: boolean
  hasIccProfile: boolean
  iccProfileResourceId?: ResourceId
  /** 从 AVIF/HEIF nclx box 有界解析；缺失或非法时为 null，不按位深猜测 HDR。 */
  cicp: {
    colorPrimaries: number
    transferCharacteristics: number
    matrixCoefficients: number
    fullRange: boolean
  } | null
  hdr: boolean
}

export interface SourcePyramidLevel {
  mip: number
  width: number
  height: number
  columns: number
  rows: number
}

export interface SourcePyramidDescriptor {
  tileSize: typeof IMAGE_EDIT_TILE_SIZE
  levels: SourcePyramidLevel[]
}

export interface SourcePyramidPrewarmRequest {
  resourceId: ResourceId
  bitDepth?: 8 | 16 | 32
  /** 包含边界；默认从 mip 0 到最粗层。 */
  minimumMip?: number
  maximumMip?: number
  /** 防止极端长宽比素材一次预热无界数量的瓦片。 */
  tileBudget?: number
  signal?: AbortSignal
}

export interface SourcePyramidPrewarmResult {
  plannedTiles: number
  completedTiles: number
  truncated: boolean
}

export interface SourceTileRequest {
  resourceId: ResourceId
  mip: number
  tileX: number
  tileY: number
  /** 输出像素中的邻域，local effect 可据此请求 halo。 */
  halo?: number
  /** 省略时按源精度选择，禁止把 16-bit/float 权威像素静默降为 8-bit。 */
  bitDepth?: 8 | 16 | 32
  signal?: AbortSignal
}

export interface SourceTile {
  resourceId: ResourceId
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
  /** 8/16 位是感知编码 sRGB，float 是线性 scRGB；执行器必须显式转换到文档工作空间。 */
  colorSpace: 'srgb' | 'scrgb'
  transferFunction: 'srgb' | 'linear'
  /** Sharp raw 输出是 straight alpha；进入效果内核前必须在线性域预乘。 */
  alphaMode: 'straight'
  orientationApplied: false
  /** 相对于当前 mip 左上角的位置，可能因 halo 小于请求瓦片原点。 */
  originX: number
  originY: number
  pixels: Buffer
}

export interface FastSourceProxy {
  resourceId: ResourceId
  width: number
  height: number
  format: 'webp'
  bytes: Buffer
}

export interface SourceProvider {
  readMetadata(resourceId: ResourceId, signal?: AbortSignal): Promise<SourceImageMetadata>
  describePyramid(resourceId: ResourceId, signal?: AbortSignal): Promise<SourcePyramidDescriptor>
  prewarmPyramid(request: SourcePyramidPrewarmRequest): Promise<SourcePyramidPrewarmResult>
  readFastProxy(resourceId: ResourceId, maxDimension: number, signal?: AbortSignal): Promise<FastSourceProxy>
  readTile(request: SourceTileRequest): Promise<SourceTile>
  openOriginal(resourceId: ResourceId, signal?: AbortSignal): Promise<Readable>
}

export interface TileOutputDescription {
  width: number
  height: number
  channels: 4
  bitDepth: 8 | 16 | 32
  sampleFormat: 'uint' | 'float'
  colorSpace: 'srgb' | 'display-p3' | 'rec2020'
  transferFunction: 'srgb' | 'linear' | 'pq' | 'hlg'
  alphaMode: 'straight' | 'premultiplied'
  iccProfileResourceId?: ResourceId
  cicp?: SourceImageMetadata['cicp']
  hdrMetadata?: {
    maxLuminanceNits?: number
    minLuminanceNits?: number
    maxContentLightLevelNits?: number
    maxFrameAverageLightLevelNits?: number
  }
  documentId: string
  revision: number
  sourceFingerprint?: string
}

export interface OutputTile {
  x: number
  y: number
  width: number
  height: number
  rowStride: number
  pixels: Uint8Array
}

export interface TileOutputSink {
  begin(description: TileOutputDescription): Promise<void>
  writeTile(tile: OutputTile): Promise<void>
  complete(): Promise<void>
  cancel(reason?: unknown): Promise<void>
}
