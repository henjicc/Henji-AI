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

export interface PrepareNodeImageSourceResultDto {
  imagePath: string
  previewImagePath: string
  aspectRatio: string
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
  fileSizeBytes: number
  createdAt: number | null
  modifiedAt: number | null
}

export interface ImageBytes {
  bytes: Buffer
  extension: string
}
