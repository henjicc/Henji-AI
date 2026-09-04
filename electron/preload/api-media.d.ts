export interface HenjiImageMergeStoryboardImagesPayload {
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

export interface HenjiImageMergeStoryboardImagesResult {
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

export interface HenjiImageStoryboardImageMetadata {
  gridRows: number
  gridCols: number
  frameNotes: string[]
}

export interface HenjiImagePanoramaMetadata {
  projectionType: 'equirectangular'
  usePanoramaViewer: true
  fullPanoWidthPixels: number
  fullPanoHeightPixels: number
  croppedAreaImageWidthPixels: number
  croppedAreaImageHeightPixels: number
  croppedAreaLeftPixels: number
  croppedAreaTopPixels: number
}

export interface HenjiImagePanoramaMetadataReadResult {
  format: 'png' | 'jpeg' | 'webp' | 'unsupported'
  status: 'valid' | 'absent' | 'invalid' | 'unsupported'
  metadata: HenjiImagePanoramaMetadata | null
  reason?: string
}

export interface HenjiImagePanoramaMetadataEmbedResult {
  imagePath: string
  format: 'png' | 'jpeg' | 'webp'
  metadata: HenjiImagePanoramaMetadata
}

export interface HenjiImagePrepareNodeImageSourceResult {
  imagePath: string
  previewImagePath: string
  aspectRatio: string
  createdFilePaths: string[]
}

export interface HenjiImagePersistSourceTrackedResult {
  imagePath: string
  createdFilePaths: string[]
}

export interface HenjiImageCropImageSourcePayload {
  source: string
  aspectRatio?: string
  cropX?: number
  cropY?: number
  cropWidth?: number
  cropHeight?: number
}

export interface HenjiImageInfoResult {
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

export interface HenjiImageDiffusionFallbackRequest {
  requestId: string
  source: string
  purpose: 'preview' | 'export'
  format: 'png' | 'jpeg' | 'webp'
  quality?: number
  maxPreviewPixels?: number
  params: unknown
}

export interface HenjiImageDiffusionFallbackResult {
  bytes: Uint8Array
  width: number
  height: number
  format: 'png' | 'jpeg' | 'webp'
  durationMs: number
  hardCancellationSupported: false
  unsupportedParameters: readonly string[]
}

export interface HenjiImageDiffusionFallbackCapabilities {
  available: boolean
  supportedParameters: readonly string[]
  unsupportedParameters: readonly string[]
  maxPreviewPixels: number
  hardCancellationSupported: false
  supportedFormats: readonly ['png', 'jpeg', 'webp']
  reason?: string
}

export interface HenjiImageComposeLayerStackPayload {
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
  persistSourceLayers?: boolean
}

export interface HenjiImageComposeLayerStackResult {
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

export interface HenjiImageApi {
  splitImage(imageBase64: string, rows: number, cols: number, lineThickness: number): Promise<string[]>
  splitImageSource(source: string, rows: number, cols: number, lineThickness: number): Promise<string[]>
  prepareNodeImageSource(source: string, maxPreviewDimension: number): Promise<HenjiImagePrepareNodeImageSourceResult>
  prepareNodeImageBinary(bytes: Uint8Array, extension: string | undefined, maxPreviewDimension: number): Promise<HenjiImagePrepareNodeImageSourceResult>
  cropImageSource(payload: HenjiImageCropImageSourcePayload): Promise<string>
  prepareLocalRedraw(payload: {
    source: string
    mask: string
    preferredAspectRatios?: number[]
    settings: {
      contextScale: number
      aspectRatio: 'auto' | '1:1' | '4:3' | '3:4' | '16:9' | '9:16'
      registrationQuality: 'fast' | 'precise' | 'extreme'
      featherPixels: number
      forceRegistration: boolean
    }
  }): Promise<{
    cropSource: string
    createdFilePaths: string[]
    context: {
      version: 2
      requestId: string
      source: string
      mask: string
      sourceWidth: number
      sourceHeight: number
      crop: { x: number; y: number; width: number; height: number }
      matchedAspectRatio: number | null
      settings: {
        contextScale: number
        aspectRatio: 'auto' | '1:1' | '4:3' | '3:4' | '16:9' | '9:16'
        registrationQuality: 'fast' | 'precise' | 'extreme'
        featherPixels: number
        forceRegistration: boolean
      }
    }
  }>
  composeLocalRedraw(payload: {
    generatedSource: string
    context: Record<string, unknown>
  }): Promise<{ source: string; registrationApplied: boolean; diagnostics: Record<string, unknown> }>
  mergeStoryboardImages(payload: HenjiImageMergeStoryboardImagesPayload): Promise<HenjiImageMergeStoryboardImagesResult>
  readStoryboardImageMetadata(source: string): Promise<HenjiImageStoryboardImageMetadata | null>
  embedStoryboardImageMetadata(source: string, metadata: HenjiImageStoryboardImageMetadata): Promise<string>
  readPanoramaImageMetadata(source: string): Promise<HenjiImagePanoramaMetadataReadResult>
  embedPanoramaImageMetadata(source: string): Promise<HenjiImagePanoramaMetadataEmbedResult>
  loadImage(filePath: string): Promise<string>
  persistImageSource(source: string): Promise<string>
  persistImageSourceTracked(source: string): Promise<HenjiImagePersistSourceTrackedResult>
  persistImageBinary(bytes: Uint8Array, extension: string): Promise<string>
  saveImageSourceToDownloads(source: string, suggestedFileName?: string): Promise<string>
  saveImageSourceToPath(source: string, targetPath: string): Promise<string>
  savePanoramaImageSourceToPath(source: string, targetPath: string): Promise<string>
  saveImageSourceToDirectory(source: string, targetDir: string, suggestedFileName?: string): Promise<string>
  savePanoramaImageSourceToDirectory(source: string, targetDir: string, suggestedFileName?: string): Promise<string>
  saveImageSourceToAppDebugDir(source: string, category: string, suggestedFileName?: string): Promise<string>
  readImageInfo(source: string): Promise<HenjiImageInfoResult>
  probeDiffusionFallback(): Promise<HenjiImageDiffusionFallbackCapabilities>
  renderDiffusionFallback(request: HenjiImageDiffusionFallbackRequest): Promise<HenjiImageDiffusionFallbackResult>
  compressImageSource(payload: {
    source: string
    maxPixels?: number
    quality?: number
    maxDimension?: number
  }): Promise<{ fullPath: string; dataUrl: string }>
  generateThumbnailBytes(payload: { source: string; maxSize?: number }): Promise<{ bytes: Uint8Array }>
  composeLayerStack(payload: HenjiImageComposeLayerStackPayload): Promise<HenjiImageComposeLayerStackResult>
  releaseLayerStackResources(filePaths: string[]): Promise<void>
  releaseManagedGenerationMedia(filePaths: string[]): Promise<void>
}

export interface HenjiVideoInfoResult {
  durationSeconds: number
  width: number
  height: number
  hasAudio: boolean
}

export interface HenjiVideoTrimVideoSourcePayload {
  source: string
  startSeconds: number
  endSeconds: number
}

export interface HenjiVideoTrimVideoSourceResult {
  path: string
  durationSeconds: number
}

export interface HenjiVideoCompressVideoToFitPayload {
  source: string
  maxSizeMB: number
}

export interface HenjiVideoCompressVideoToFitResult {
  path: string
  sizeBytes: number
}

export interface HenjiVideoStartFrameExportPayload {
  frameCount: number
  fps: number
  width: number
  height: number
  fileNameStem: string
}

export interface HenjiVideoAppendFrameExportPayload {
  sessionId: string
  frameIndex: number
  bytes: Uint8Array
}

export interface HenjiVideoFinishFrameExportPayload {
  sessionId: string
  targetPath?: string
}

export interface HenjiVideoFrameExportResult {
  mediaPath: string
  savedPath: string
  durationSeconds: number
  frameCount: number
  width: number
  height: number
}

export interface HenjiVideoFrameExportProgress {
  sessionId: string
  encodedFrames: number
}

export interface HenjiVideoApi {
  readVideoInfo(source: string): Promise<HenjiVideoInfoResult>
  trimVideoSource(payload: HenjiVideoTrimVideoSourcePayload): Promise<HenjiVideoTrimVideoSourceResult>
  compressVideoToFit(payload: HenjiVideoCompressVideoToFitPayload): Promise<HenjiVideoCompressVideoToFitResult>
  generateThumbnail(payload: { source: string; timeOffsetSeconds?: number; knownDurationSeconds?: number }): Promise<{ dataUrl: string }>
  generateThumbnailBytes(payload: { source: string; maxSize?: number }): Promise<{ bytes: Uint8Array }>
  startFrameExport(payload: HenjiVideoStartFrameExportPayload): Promise<{ sessionId: string }>
  appendFrameExport(payload: HenjiVideoAppendFrameExportPayload): Promise<{ frameIndex: number }>
  finishFrameExport(payload: HenjiVideoFinishFrameExportPayload): Promise<HenjiVideoFrameExportResult>
  cancelFrameExport(sessionId: string): Promise<void>
  onFrameExportProgress(listener: (progress: HenjiVideoFrameExportProgress) => void): () => void
}

export interface HenjiAudioExtractSamplesResult {
  rms: number[]
  peak: number[]
  durationSeconds: number
}

export interface HenjiAudioApi {
  extractSamples(payload: { source: string; bucketCount: number }): Promise<HenjiAudioExtractSamplesResult>
}
