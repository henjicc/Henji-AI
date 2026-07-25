import type { DiffusionOperationParams } from '@/core/imageEdit/types'

export interface MergeStoryboardImagesPayload {
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

export interface MergeStoryboardImagesResult {
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

export interface StoryboardImageMetadata {
  gridRows: number
  gridCols: number
  frameNotes: string[]
}

export interface PrepareNodeImageSourceResult {
  imagePath: string
  previewImagePath: string
  aspectRatio: string
}

export interface CropImageSourcePayload {
  source: string
  aspectRatio?: string
  cropX?: number
  cropY?: number
  cropWidth?: number
  cropHeight?: number
}

export interface ImageInfoResult {
  source: string
  fileName: string | null
  extension: string
  width: number
  height: number
  fileSizeBytes: number
  createdAt: number | null
  modifiedAt: number | null
}

export interface ImageDiffusionFallbackRequest {
  requestId: string
  source: string
  purpose: 'preview' | 'export'
  format: 'png' | 'jpeg' | 'webp'
  quality?: number
  maxPreviewPixels?: number
  params: DiffusionOperationParams
}

export interface ImageDiffusionFallbackResult {
  bytes: Uint8Array
  width: number
  height: number
  format: 'png' | 'jpeg' | 'webp'
  durationMs: number
  hardCancellationSupported: false
  unsupportedParameters: readonly string[]
}

export interface ImageDiffusionFallbackCapabilities {
  available: boolean
  supportedParameters: readonly string[]
  unsupportedParameters: readonly string[]
  maxPreviewPixels: number
  hardCancellationSupported: false
  supportedFormats: readonly ['png', 'jpeg', 'webp']
  reason?: string
}

/**
 * 16 个图像处理原生命令（1.1 已核对，不含剪贴板相关 2 个命令，见 contracts/clipboard.ts）。
 */
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
  mergeStoryboardImages(payload: MergeStoryboardImagesPayload): Promise<MergeStoryboardImagesResult>
  readStoryboardImageMetadata(source: string): Promise<StoryboardImageMetadata | null>
  embedStoryboardImageMetadata(source: string, metadata: StoryboardImageMetadata): Promise<string>
  loadImage(filePath: string): Promise<string>
  persistImageSource(source: string): Promise<string>
  persistImageBinary(bytes: Uint8Array, extension: string): Promise<string>
  saveImageSourceToDownloads(source: string, suggestedFileName?: string): Promise<string>
  saveImageSourceToPath(source: string, targetPath: string): Promise<string>
  saveImageSourceToDirectory(source: string, targetDir: string, suggestedFileName?: string): Promise<string>
  saveImageSourceToAppDebugDir(source: string, category: string, suggestedFileName?: string): Promise<string>
  readImageInfo(source: string): Promise<ImageInfoResult>
  probeDiffusionFallback(): Promise<ImageDiffusionFallbackCapabilities>
  renderDiffusionFallback(request: ImageDiffusionFallbackRequest): Promise<ImageDiffusionFallbackResult>
}
