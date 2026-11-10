import type { ImageEditDocumentV3 } from './documentTypes';
import type { ImageEditCommandHistorySnapshotV3 } from './commandHistoryCodec';
import type { ImageEditHistoryResourceReferenceV3 } from './commandTypes';

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

