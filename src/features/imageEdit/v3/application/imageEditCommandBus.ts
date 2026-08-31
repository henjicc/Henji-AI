import {
  ImageEditCommandHistoryV3,
  type ImageEditCommandHistoryOptionsV3,
} from '@/core/imageEdit/v3/commandHistory';
import type { ImageEditCommandV3 } from '@/core/imageEdit/v3/commandTypes';
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes';
import type {
  ImageEditDocumentRepositoryV3,
  ImageEditPersistenceSnapshotV3,
} from '@/core/imageEdit/v3/serviceContracts';
import type { ImageEditCommandHistorySnapshotV3 } from '@/core/imageEdit/v3/commandHistoryCodec';
import { isImageEditTransformInvertibleV3 } from '@/core/imageEdit/v3/execution/affineTransform';

export type ImageEditPreviewOverrideKindV3 =
  | 'parameter'
  | 'crop'
  | 'transform'
  | 'brush';

export interface ImageEditPreviewOverrideV3 {
  id: string;
  kind: ImageEditPreviewOverrideKindV3;
  targetId: string;
  baseRevision: number;
  value: unknown;
}

export interface ImageEditCommandBusSnapshotV3 {
  document: ImageEditDocumentV3;
  previewOverrides: Readonly<Record<string, ImageEditPreviewOverrideV3>>;
  history: ReturnType<ImageEditCommandHistoryV3['getState']>;
}

export interface ImageEditCommandBusOptionsV3 {
  repository?: ImageEditDocumentRepositoryV3;
  history?: ImageEditCommandHistoryOptionsV3;
  historySnapshot?: ImageEditCommandHistorySnapshotV3 | null;
  onPersistentChange?: (snapshot: ImageEditPersistenceSnapshotV3) => void;
}

type ImageEditCommandBusListenerV3 = (snapshot: ImageEditCommandBusSnapshotV3) => void;

/**
 * V3 持久状态的唯一写入口。滑杆、变换和画笔过程只更新 preview override，
 * 手势结束后再通过 commitPreview 提交一个命令和一个历史单位。
 */
export class ImageEditCommandBusV3 {
  private document: ImageEditDocumentV3;
  private readonly history: ImageEditCommandHistoryV3;
  private readonly repository?: ImageEditDocumentRepositoryV3;
  private readonly onPersistentChange?: (snapshot: ImageEditPersistenceSnapshotV3) => void;
  private readonly previewOverrides = new Map<string, ImageEditPreviewOverrideV3>();
  private readonly listeners = new Set<ImageEditCommandBusListenerV3>();

  constructor(document: ImageEditDocumentV3, options: ImageEditCommandBusOptionsV3 = {}) {
    this.document = document;
    this.history = new ImageEditCommandHistoryV3(options.history);
    if (options.historySnapshot) this.history.restore(document, options.historySnapshot);
    else this.history.clear(document);
    this.repository = options.repository;
    this.onPersistentChange = options.onPersistentChange;
  }

  getSnapshot(): ImageEditCommandBusSnapshotV3 {
    return {
      document: this.document,
      previewOverrides: Object.fromEntries(this.previewOverrides),
      history: this.history.getState(),
    };
  }

  subscribe(listener: ImageEditCommandBusListenerV3): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getPersistenceSnapshot(): ImageEditPersistenceSnapshotV3 {
    return {
      document: this.document,
      history: this.history.createSnapshot(),
      retainedResources: this.history.getRetainedResources(),
    };
  }

  dispatch(command: ImageEditCommandV3): ImageEditDocumentV3 {
    const previousRevision = this.document.revision;
    this.document = this.history.execute(this.document, command);
    this.persistChange(previousRevision);
    this.emit();
    return this.document;
  }

  setPreview(override: ImageEditPreviewOverrideV3): void {
    if (override.baseRevision !== this.document.revision) {
      throw new Error(`预览覆盖版本过期：${override.baseRevision} !== ${this.document.revision}`);
    }
    if (override.kind === 'transform') {
      const value = override.value && typeof override.value === 'object' && !Array.isArray(override.value)
        ? (override.value as { transform?: unknown }).transform
        : override.value;
      if (!isImageEditTransformInvertibleV3(value)) {
        throw new Error('图层预览变换必须是可逆的有限仿射矩阵');
      }
    }
    this.previewOverrides.set(override.id, override);
    this.emit();
  }

  clearPreview(id: string): void {
    if (!this.previewOverrides.delete(id)) return;
    this.emit();
  }

  commitPreview(id: string, command: ImageEditCommandV3): ImageEditDocumentV3 {
    const preview = this.previewOverrides.get(id);
    if (!preview) throw new Error(`预览覆盖不存在：${id}`);
    if (preview.baseRevision !== this.document.revision) {
      this.previewOverrides.delete(id);
      throw new Error('预览覆盖对应的文档版本已经变化');
    }
    this.previewOverrides.delete(id);
    return this.dispatch(command);
  }

  undo(): boolean {
    const previousRevision = this.document.revision;
    const transition = this.history.undo(this.document);
    if (!transition.changed) return false;
    this.document = transition.document;
    this.previewOverrides.clear();
    this.persistChange(previousRevision);
    this.emit();
    return true;
  }

  undoCommands(commandIdsNewestFirst: readonly string[]): boolean {
    const previousRevision = this.document.revision;
    const transition = this.history.undoCommands(this.document, commandIdsNewestFirst);
    if (!transition.changed) return false;
    this.document = transition.document;
    this.previewOverrides.clear();
    this.persistChange(previousRevision);
    this.emit();
    return true;
  }

  rollbackCommands(commandIdsNewestFirst: readonly string[]): boolean {
    const previousRevision = this.document.revision;
    const transition = this.history.rollbackCommands(this.document, commandIdsNewestFirst);
    if (!transition.changed) return false;
    this.document = transition.document;
    this.previewOverrides.clear();
    this.persistChange(previousRevision);
    this.emit();
    return true;
  }

  redo(): boolean {
    const previousRevision = this.document.revision;
    const transition = this.history.redo(this.document);
    if (!transition.changed) return false;
    this.document = transition.document;
    this.previewOverrides.clear();
    this.persistChange(previousRevision);
    this.emit();
    return true;
  }

  clearHistory(): void {
    this.history.clear(this.document);
    this.previewOverrides.clear();
    this.persistChange(this.document.revision);
    this.emit();
  }

  dispose(): void {
    this.repository?.cancelAutosave(this.document.id);
    this.previewOverrides.clear();
    this.listeners.clear();
  }

  private persistChange(expectedRevision: number): void {
    const snapshot = this.getPersistenceSnapshot();
    this.repository?.scheduleAutosave(this.document, {
      expectedRevision,
      previewRef: null,
      history: snapshot.history,
    });
    this.onPersistentChange?.(snapshot);
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}
