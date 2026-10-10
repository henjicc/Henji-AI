import type { ImageEditDocumentV3 } from './documentTypes';
import type { ImageEditCommandHistorySnapshotV3 } from './commandHistoryCodec';
import type { ImageEditHistoryResourceReferenceV3 } from './commandTypes';
import type { ImageEditRect, ImageEditSize, ImageEditTileCoordinate } from './tileGeometry';

export interface ImageEditDocumentReferenceV3 {
  documentId: string;
  revision: number;
  previewRef: string | null;
  /** 保存确认后的分页历史源，供实例释放已保存的命令尾部。 */
  history?: ImageEditCommandHistorySnapshotV3 | null;
}

export interface ImageEditDocumentSnapshotV3 extends ImageEditDocumentReferenceV3 {
  document: ImageEditDocumentV3;
  /** V3 快照没有保存历史时为 null；不接受旧版图片文档。 */
  history: ImageEditCommandHistorySnapshotV3 | null;
}

export interface ImageEditPersistenceSnapshotV3 {
  document: ImageEditDocumentV3;
  history: ImageEditCommandHistorySnapshotV3;
  retainedResources: ImageEditHistoryResourceReferenceV3[];
}

export interface ImageEditSaveDocumentOptionsV3 {
  expectedRevision: number;
  previewRef?: string | null;
  history?: ImageEditCommandHistorySnapshotV3 | null;
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
  /** 等最近一次自动保存落盘后再以完整 live set 触发资源回收。 */
  scheduleGarbageCollection?(documentId: string, retainedResourceIds: readonly string[]): void;
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
