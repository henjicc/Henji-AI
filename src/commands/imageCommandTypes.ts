export interface MergeStoryboardImagesPayload {
  frameSources: string[];
  rows: number;
  cols: number;
  cellGap: number;
  outerPadding: number;
  noteHeight: number;
  fontSize: number;
  backgroundColor: string;
  maxDimension: number;
  showFrameIndex?: boolean;
  showFrameNote?: boolean;
  notePlacement?: 'overlay' | 'bottom';
  imageFit?: 'cover' | 'contain';
  frameIndexPrefix?: string;
  textColor?: string;
  frameNotes?: string[];
}

export interface StoryboardImageMetadata {
  gridRows: number;
  gridCols: number;
  frameNotes: string[];
}

export interface PrepareNodeImageSourceResult {
  imagePath: string;
  previewImagePath: string;
  aspectRatio: string;
  createdFilePaths: string[];
}

export interface CropImageSourcePayload {
  source: string;
  aspectRatio?: string;
  cropX?: number;
  cropY?: number;
  cropWidth?: number;
  cropHeight?: number;
}

export interface MergeStoryboardImagesResult {
  imagePath: string;
  canvasWidth: number;
  canvasHeight: number;
  cellWidth: number;
  cellHeight: number;
  gap: number;
  padding: number;
  noteHeight: number;
  fontSize: number;
  textOverlayApplied: boolean;
  metadataEmbedded?: boolean;
}

export interface ImageInfoResult {
  source: string;
  fileName: string | null;
  extension: string;
  width: number;
  height: number;
  orientation: number | null;
  hasAlpha: boolean;
  fileSizeBytes: number;
  createdAt: number | null;
  modifiedAt: number | null;
}
