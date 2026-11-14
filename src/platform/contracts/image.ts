import type { DiffusionOperationParams } from '@/core/imageEdit/types'

interface MergeStoryboardImagesPayload {
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

interface MergeStoryboardImagesResult {
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

interface StoryboardImageMetadata {
  gridRows: number
  gridCols: number
  frameNotes: string[]
}

interface PanoramaImageMetadata {
  projectionType: 'equirectangular'
  usePanoramaViewer: true
  fullPanoWidthPixels: number
  fullPanoHeightPixels: number
  croppedAreaImageWidthPixels: number
  croppedAreaImageHeightPixels: number
  croppedAreaLeftPixels: number
  croppedAreaTopPixels: number
}

export interface PanoramaMetadataReadResult {
  format: 'png' | 'jpeg' | 'webp' | 'unsupported'
  status: 'valid' | 'absent' | 'invalid' | 'unsupported'
  metadata: PanoramaImageMetadata | null
  reason?: string
}

export interface PanoramaMetadataEmbedResult {
  imagePath: string
  format: 'png' | 'jpeg' | 'webp'
  metadata: PanoramaImageMetadata
}

interface PrepareNodeImageSourceResult {
  imagePath: string
  previewImagePath: string
  aspectRatio: string
  createdFilePaths: string[]
}

export interface PersistImageSourceTrackedResult {
  imagePath: string
  createdFilePaths: string[]
}

interface CropImageSourcePayload {
  source: string
  aspectRatio?: string
  cropX?: number
  cropY?: number
  cropWidth?: number
  cropHeight?: number
}

type LocalRedrawRegistrationQuality = 'fast' | 'precise' | 'extreme'
type LocalRedrawAspectRatio = 'auto' | '1:1' | '4:3' | '3:4' | '16:9' | '9:16'

export interface LocalRedrawSettings {
  contextScale: number
  aspectRatio: LocalRedrawAspectRatio
  registrationQuality: LocalRedrawRegistrationQuality
  featherPixels: number
  forceRegistration: boolean
}

export interface LocalRedrawContext {
  version: 2
  requestId: string
  source: string
  mask: string
  sourceWidth: number
  sourceHeight: number
  crop: { x: number; y: number; width: number; height: number }
  matchedAspectRatio: number | null
  settings: LocalRedrawSettings
}

interface LocalRedrawRegistrationDiagnostics {
  referenceKeypoints: number
  movingKeypoints: number
  matches: number
  inliers: number
  inlierRatio: number
  coverage: number
  medianError: number
  structuralScore: number
  scaleX: number
  scaleY: number
  translationX: number
  translationY: number
  refinementIterations: number
  elapsedMs: number
  acceptanceMode?: 'global' | 'local-anchors' | 'forced'
  anchorCells?: number
  anchorSpread?: number
  anchorStructuralScore?: number
  anisotropicAccepted?: boolean
  compositionFallbackReason?: string
  selectionCoverage?: number
  selectedChangeFraction?: number
  selectedMeanAbsoluteDelta?: number
  reason?: string
}

export interface PrepareLocalRedrawResult {
  cropSource: string
  createdFilePaths: string[]
  context: LocalRedrawContext
}

export interface ComposeLocalRedrawResult {
  source: string
  registrationApplied: boolean
  diagnostics: LocalRedrawRegistrationDiagnostics
}

interface ImageInfoResult {
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

interface ImageDiffusionFallbackRequest {
  requestId: string
  source: string
  purpose: 'preview' | 'export'
  format: 'png' | 'jpeg' | 'webp'
  quality?: number
  maxPreviewPixels?: number
  params: DiffusionOperationParams
}

interface ImageDiffusionFallbackResult {
  bytes: Uint8Array
  width: number
  height: number
  format: 'png' | 'jpeg' | 'webp'
  durationMs: number
  hardCancellationSupported: false
  unsupportedParameters: readonly string[]
}

interface ImageDiffusionFallbackCapabilities {
  available: boolean
  supportedParameters: readonly string[]
  unsupportedParameters: readonly string[]
  maxPreviewPixels: number
  hardCancellationSupported: false
  supportedFormats: readonly ['png', 'jpeg', 'webp']
  reason?: string
}

export interface ComposeLayerStackPayload {
  requestId: string
  stackId: string
  layers: Array<{
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
  }>
  thumbnailMaxSize?: number
  /** 仅首次接收模型输出时持久化输入层；重新合成必须复用已有受管文件。 */
  persistSourceLayers?: boolean
}

export interface ComposeLayerStackResult {
  stackId: string
  canvasWidth: number
  canvasHeight: number
  resources: Array<{
    sourceOutputIndex: number
    filePath: string
    mimeType: 'image/png' | 'image/webp' | 'image/jpeg'
    width: number
    height: number
    hasAlpha: boolean
    byteLength: number
    sha256: string
    placement: { x: number; y: number; width: number; height: number }
  }>
  compositePath: string
  compositeSha256: string
  thumbnailPath: string
  thumbnailSha256: string
  thumbnailWidth: number
  thumbnailHeight: number
  createdFilePaths: string[]
}

/** 图像处理原生命令；剪贴板能力单独归属 contracts/clipboard.ts。 */
export interface ImagePlatform {
  splitImage(imageBase64: string, rows: number, cols: number, lineThickness: number): Promise<string[]>
  splitImageSource(source: string, rows: number, cols: number, lineThickness: number): Promise<string[]>
  prepareNodeImageSource(source: string, maxPreviewDimension: number): Promise<PrepareNodeImageSourceResult>
  prepareNodeImageBinary(
    bytes: Uint8Array,
    extension: string | undefined,
    maxPreviewDimension: number
  ): Promise<PrepareNodeImageSourceResult>
  cropImageSource(payload: CropImageSourcePayload): Promise<string>
  prepareLocalRedraw(payload: {
    source: string
    mask: string
    settings: LocalRedrawSettings
    preferredAspectRatios?: number[]
  }): Promise<PrepareLocalRedrawResult>
  composeLocalRedraw(payload: {
    generatedSource: string
    context: LocalRedrawContext
  }): Promise<ComposeLocalRedrawResult>
  mergeStoryboardImages(payload: MergeStoryboardImagesPayload): Promise<MergeStoryboardImagesResult>
  readStoryboardImageMetadata(source: string): Promise<StoryboardImageMetadata | null>
  embedStoryboardImageMetadata(source: string, metadata: StoryboardImageMetadata): Promise<string>
  readPanoramaImageMetadata(source: string): Promise<PanoramaMetadataReadResult>
  embedPanoramaImageMetadata(source: string): Promise<PanoramaMetadataEmbedResult>
  loadImage(filePath: string): Promise<string>
  persistImageSource(source: string): Promise<string>
  persistImageSourceTracked(source: string): Promise<PersistImageSourceTrackedResult>
  persistImageBinary(bytes: Uint8Array, extension: string): Promise<string>
  saveImageSourceToDownloads(source: string, suggestedFileName?: string): Promise<string>
  saveImageSourceToPath(source: string, targetPath: string): Promise<string>
  savePanoramaImageSourceToPath(source: string, targetPath: string): Promise<string>
  saveImageSourceToDirectory(source: string, targetDir: string, suggestedFileName?: string): Promise<string>
  savePanoramaImageSourceToDirectory(source: string, targetDir: string, suggestedFileName?: string): Promise<string>
  saveImageSourceToAppDebugDir(source: string, category: string, suggestedFileName?: string): Promise<string>
  readImageInfo(source: string): Promise<ImageInfoResult>
  /** 主进程生成并落盘的缩略图（与素材库共用缓存）；source 为本机路径或 henji-media 地址，maxSize 缺省为素材库尺寸。 */
  getCachedThumbnail(source: string, maxSize?: number): Promise<{ path: string }>
  probeDiffusionFallback(): Promise<ImageDiffusionFallbackCapabilities>
  renderDiffusionFallback(request: ImageDiffusionFallbackRequest): Promise<ImageDiffusionFallbackResult>
  composeLayerStack(payload: ComposeLayerStackPayload): Promise<ComposeLayerStackResult>
  releaseLayerStackResources(filePaths: string[]): Promise<void>
  releaseManagedGenerationMedia(filePaths: string[]): Promise<void>
}
