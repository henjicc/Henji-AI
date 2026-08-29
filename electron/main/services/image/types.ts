export interface MergeStoryboardImagesPayloadDto {
  frameSources: string[]
  rows: number
  cols: number
  cellGap: number
  outerPadding: number
  noteHeight: number
  fontSize: number
  backgroundColor: string
  maxDimension: number
  showFrameIndex?: boolean
  showFrameNote?: boolean
  notePlacement?: 'overlay' | 'bottom'
  imageFit?: 'cover' | 'contain'
  frameIndexPrefix?: string
  textColor?: string
  frameNotes?: string[]
}

export interface MergeStoryboardImagesResultDto {
  imagePath: string
  canvasWidth: number
  canvasHeight: number
  cellWidth: number
  cellHeight: number
  gap: number
  padding: number
  noteHeight: number
  fontSize: number
  textOverlayApplied: boolean
  metadataEmbedded?: boolean
}

export interface StoryboardImageMetadataDto {
  gridRows: number
  gridCols: number
  frameNotes: string[]
}

export interface PanoramaImageMetadataDto {
  projectionType: 'equirectangular'
  usePanoramaViewer: true
  fullPanoWidthPixels: number
  fullPanoHeightPixels: number
  croppedAreaImageWidthPixels: number
  croppedAreaImageHeightPixels: number
  croppedAreaLeftPixels: number
  croppedAreaTopPixels: number
}

export interface PanoramaMetadataReadResultDto {
  format: 'png' | 'jpeg' | 'webp' | 'unsupported'
  status: 'valid' | 'absent' | 'invalid' | 'unsupported'
  metadata: PanoramaImageMetadataDto | null
  reason?: string
}

export interface PanoramaMetadataEmbedResultDto {
  imagePath: string
  format: 'png' | 'jpeg' | 'webp'
  metadata: PanoramaImageMetadataDto
}

export interface PrepareNodeImageSourceResultDto {
  imagePath: string
  previewImagePath: string
  aspectRatio: string
  /** 仅本次新建的受管文件；画布事务失败时由调用方精确回滚。 */
  createdFilePaths: string[]
}

export interface CropImageSourcePayloadDto {
  source: string
  aspectRatio?: string
  cropX?: number
  cropY?: number
  cropWidth?: number
  cropHeight?: number
}

export interface ImageInfoResultDto {
  source: string
  fileName: string | null
  extension: string
  width: number
  height: number
  orientation: number | null
  hasAlpha: boolean
  fileSizeBytes: number
  createdAt: number | null
  modifiedAt: number | null
}

export interface ImageBytes {
  bytes: Buffer
  extension: string
}

export interface ComposeLayerStackLayerPayloadDto {
  sourceOutputIndex: number
  source: string
  zIndex: number
  role: 'base' | 'content'
  name?: string
  description?: string
  declaredWidth: number
  declaredHeight: number
  declaredFormat: 'png' | 'jpeg' | 'webp'
  boundingBox?: {
    absolute?: [number, number, number, number]
    normalized?: [number, number, number, number]
  }
  opacity?: number
  visible?: boolean
}

export interface ComposeLayerStackPayloadDto {
  requestId: string
  stackId: string
  layers: ComposeLayerStackLayerPayloadDto[]
  thumbnailMaxSize?: number
  /** 仅首次接收模型输出时持久化输入层；重新合成必须复用已有受管文件。 */
  persistSourceLayers?: boolean
}

export interface ComposedLayerStackResourceDto {
  sourceOutputIndex: number
  filePath: string
  mimeType: 'image/png' | 'image/webp' | 'image/jpeg'
  width: number
  height: number
  hasAlpha: boolean
  byteLength: number
  sha256: string
  placement: { x: number; y: number; width: number; height: number }
}

export interface ComposeLayerStackResultDto {
  stackId: string
  canvasWidth: number
  canvasHeight: number
  resources: ComposedLayerStackResourceDto[]
  compositePath: string
  compositeSha256: string
  thumbnailPath: string
  thumbnailSha256: string
  thumbnailWidth: number
  thumbnailHeight: number
  /** 仅用于调用方在画布事务失败时回滚；不会写入图层栈文档。 */
  createdFilePaths: string[]
}
