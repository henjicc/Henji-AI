import type { ImageEditDocumentV3 } from './documentTypes';
import type { ImageEditRect, ImageEditSize, ImageEditTileCoordinate } from './tileGeometry';

export interface ImageEditDocumentReferenceV3 {
  documentId: string;
  revision: number;
  previewRef: string | null;
}

export interface ImageEditDocumentSnapshotV3 extends ImageEditDocumentReferenceV3 {
  document: ImageEditDocumentV3;
}

export interface ImageEditSaveDocumentOptionsV3 {
  expectedRevision: number;
  previewRef?: string | null;
  signal?: AbortSignal;
}

export interface ImageEditDocumentRepositoryV3 {
  load(documentId: string, signal?: AbortSignal): Promise<ImageEditDocumentSnapshotV3 | null>;
  save(
    document: ImageEditDocumentV3,
    options: ImageEditSaveDocumentOptionsV3,
  ): Promise<ImageEditDocumentReferenceV3>;
  scheduleAutosave(
    document: ImageEditDocumentV3,
    options: ImageEditSaveDocumentOptionsV3,
  ): void;
  cancelAutosave(documentId: string): void;
  collectGarbage(documentId: string, retainedResourceIds: readonly string[]): Promise<void>;
}

export interface ImageEditSourceMetadataV3 extends ImageEditSize {
  format: string;
  bitDepth: number | null;
  channels: number;
  hasAlpha: boolean;
  orientation: number | null;
  iccProfileResourceId: string | null;
  cicp: {
    colorPrimaries: number;
    transferCharacteristics: number;
    matrixCoefficients: number;
    fullRange: boolean;
  } | null;
  hdr: boolean;
}

export interface ImageEditSourceTileV3 {
  coordinate: ImageEditTileCoordinate;
  region: ImageEditRect;
  width: number;
  height: number;
  channels: number;
  bitDepth: 8 | 16 | 32;
  data: ArrayBuffer;
}

export interface ImageEditSourceProviderV3 {
  readMetadata(sourceResourceId: string, signal?: AbortSignal): Promise<ImageEditSourceMetadataV3>;
  readFastProxy(
    sourceResourceId: string,
    maxEdge: number,
    signal?: AbortSignal,
  ): Promise<{ resourceId: string; size: ImageEditSize }>;
  ensurePyramid(sourceResourceId: string, signal?: AbortSignal): Promise<number>;
  readTile(
    sourceResourceId: string,
    coordinate: ImageEditTileCoordinate,
    halo: number,
    signal?: AbortSignal,
  ): Promise<ImageEditSourceTileV3>;
}

export interface ImageEditTileOutputDescriptorV3 {
  width: number;
  height: number;
  channels: 3 | 4;
  bitDepth: 8 | 16 | 32;
  format: 'png' | 'jpeg' | 'webp' | 'tiff' | 'bigtiff' | 'avif';
  hdr: boolean;
  metadata: Readonly<Record<string, string | number | boolean>>;
}

export interface ImageEditTileOutputSinkV3 {
  begin(descriptor: ImageEditTileOutputDescriptorV3, signal?: AbortSignal): Promise<void>;
  writeTile(
    coordinate: ImageEditTileCoordinate,
    region: ImageEditRect,
    data: ArrayBuffer,
    signal?: AbortSignal,
  ): Promise<void>;
  writeStrip(
    y: number,
    height: number,
    data: ArrayBuffer,
    signal?: AbortSignal,
  ): Promise<void>;
  complete(signal?: AbortSignal): Promise<{ outputRef: string }>;
  cancel(): Promise<void>;
}
