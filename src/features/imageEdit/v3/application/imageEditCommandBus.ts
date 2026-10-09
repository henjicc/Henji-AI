import {
  ImageEditCommandHistoryV3,
  type ImageEditCommandHistoryOptionsV3,
} from '@/core/imageEdit/v3/commandHistory';
import type { ImageEditCommandV3 } from '@/core/imageEdit/v3/commandTypes';
import {
  collectPositiveImageEditCommandResourceBytesV3,
  prepareImageEditCommandResourceMetadataV3,
} from '@/core/imageEdit/v3/commandLayerResourceMetadata';
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes';
import type {
  ImageEditDocumentRepositoryV3,
  ImageEditPersistenceSnapshotV3,
} from '@/core/imageEdit/v3/serviceContracts';
import type { ImageEditCommandHistorySnapshotV3 } from '@/core/imageEdit/v3/commandHistoryCodec';
import { isImageEditTransformInvertibleV3 } from '@/core/imageEdit/v3/execution/affineTransform';
import { collectImageEditJsonResourceIdsV3 } from '@/core/imageEdit/v3/resourceReferences';
import { assertApplicationWritesAllowed } from '@/core/applicationLifecycle/applicationWriteBarrier';
import { imageEditSelectionSessionSchemaV3, type ImageEditSelectionSessionV3 } from '@/core/imageEdit/v3/selection/session';
import { applyImageEditCommandV3 } from '@/core/imageEdit/v3/commandReducer';
import { withImageEditCommandRevisionV3 } from '@/core/imageEdit/v3/commandTypes';
import { projectImageEditHistoryCommandV3, type ImageEditHistoryRowV3, type ImageEditHistoryViewV3, type ImageEditHistoryJumpOptionsV3 } from '@/core/imageEdit/v3/historyPaging/projection';
import { createLogger } from '@/core/logging';

const historyLogger = createLogger('features.imageEdit.v3.history');

type SessionHistoryEntry = { commandId: string; projection: ReturnType<typeof projectImageEditHistoryCommandV3> } | { selectionCommandId: number; before: ImageEditSelectionSessionV3 | null; after: ImageEditSelectionSessionV3 | null };

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
  selection: ImageEditSelectionSessionV3 | null;
  selectionRevision: number;
  document: ImageEditDocumentV3;
  previewOverrides: Readonly<Record<string, ImageEditPreviewOverrideV3>>;
  history: ReturnType<ImageEditCommandHistoryV3['getState']>;
}

export interface ImageEditCommandBusOptionsV3 {
  repository?: ImageEditDocumentRepositoryV3;
  history?: ImageEditCommandHistoryOptionsV3;
  historySnapshot?: ImageEditCommandHistorySnapshotV3 | null;
  onPersistentChange?: (snapshot: ImageEditPersistenceSnapshotV3) => void;
  /** 载入快照时由主进程返回的权威资源大小；结构命令据此生成严格历史元数据。 */
  resourceByteSizes?: Readonly<Record<string, number>>;
}

type ImageEditCommandBusListenerV3 = (snapshot: ImageEditCommandBusSnapshotV3) => void;

/**
 * V3 持久状态的唯一写入口。滑杆、变换和画笔过程只更新 preview override，
 * 手势结束后再通过 commitPreview 提交一个命令和一个历史单位。
 */
export class ImageEditCommandBusV3 {
  private selection: ImageEditSelectionSessionV3 | null = null;
  private selectionRevision = 0;
  private sessionUndo: SessionHistoryEntry[] = [];
  private sessionRedo: SessionHistoryEntry[] = [];
  private document: ImageEditDocumentV3;
  private readonly history: ImageEditCommandHistoryV3;
  private readonly repository?: ImageEditDocumentRepositoryV3;
  private readonly onPersistentChange?: (snapshot: ImageEditPersistenceSnapshotV3) => void;
  private readonly previewOverrides = new Map<string, ImageEditPreviewOverrideV3>();
  private readonly listeners = new Set<ImageEditCommandBusListenerV3>();
  private readonly persistenceListeners = new Set<(snapshot: ImageEditPersistenceSnapshotV3) => void>();
  private readonly resourceByteSizes = new Map<string, number>();
  private disposed = false;
  private readonly lifecycleAbort = new AbortController();
  private mutationGuard: (() => void) | undefined;
  private historyGeneration = 0;
  private historyJumpActive = false;

  constructor(document: ImageEditDocumentV3, options: ImageEditCommandBusOptionsV3 = {}) {
    this.document = document;
    this.history = new ImageEditCommandHistoryV3(options.history);
    if (options.historySnapshot) this.history.restore(document, options.historySnapshot);
    else this.history.clear(document);
    const restored = this.history.createSnapshot();
    this.sessionUndo = restored.undo.map(entry => ({ commandId: entry.forward.commandId, projection: projectImageEditHistoryCommandV3(entry.forward) }));
    this.sessionRedo = restored.redo.map(entry => ({ commandId: entry.forward.commandId, projection: projectImageEditHistoryCommandV3(entry.forward) }));
    this.repository = options.repository;
    this.onPersistentChange = options.onPersistentChange;
    for (const [resourceId, byteSize] of Object.entries(options.resourceByteSizes ?? {})) {
      if (!Number.isSafeInteger(byteSize) || byteSize <= 0) {
        throw new Error(`图片编辑资源字节数无效：${resourceId}`);
      }
      this.resourceByteSizes.set(resourceId, byteSize);
    }
    for (const resource of this.history.getRetainedResources()) {
      if (resource.byteSize !== null) this.resourceByteSizes.set(resource.resourceId, resource.byteSize);
    }
  }

  getSnapshot(): ImageEditCommandBusSnapshotV3 & { selection: ImageEditSelectionSessionV3 | null; selectionRevision: number } {
    return {
      selection: this.selection,
      selectionRevision: this.selectionRevision,
      document: this.document,
      previewOverrides: Object.fromEntries(this.previewOverrides),
      history: { ...this.history.getState(), undoCount: this.sessionUndo.length, redoCount: this.sessionRedo.length },
    };
  }

  /** 本地长任务绑定实例生命周期；释放即取消，迟到候选与补丁都不可提交。 */
  getLifecycleSignal(): AbortSignal { return this.lifecycleAbort.signal; }

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

  getResourceByteSizes(): Readonly<Record<string, number>> {
    return Object.fromEntries(this.resourceByteSizes);
  }

  getHistoryView(): ImageEditHistoryViewV3 {
    return { position: this.sessionUndo.length, total: this.sessionUndo.length + this.sessionRedo.length, generation: this.historyGeneration };
  }

  readHistoryPage(offset: number, limit = 64): ImageEditHistoryRowV3[] {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 256) {
      throw new RangeError('历史分页范围无效');
    }
    const rows: ImageEditHistoryRowV3[] = [];
    const total = this.sessionUndo.length + this.sessionRedo.length;
    // 页数是单次投影工作预算，不限制用户历史数量。
    for (let index = offset; index < Math.min(total + 1, offset + limit); index++) {
      if (index === 0) {
        if (offset === 0) rows.push({ position: 0, key: 'initial', kind: 'initial', labelKey: 'imageEditor.v3.history.initial', label: '开始编辑', targetName: null });
        continue;
      }
      const entry = index <= this.sessionUndo.length ? this.sessionUndo[index - 1]
        : this.sessionRedo[this.sessionRedo.length - (index - this.sessionUndo.length)];
      if ('commandId' in entry) {
        rows.push({ position: index, key: entry.commandId, kind: 'document', ...entry.projection });
      } else if (index >= offset) rows.push({ position: index, key: `selection-${entry.selectionCommandId}`, kind: 'selection', labelKey: entry.after ? 'imageEditor.v3.history.selection' : 'imageEditor.v3.history.clearSelection', label: entry.after ? '调整选区' : '取消选区', targetName: null });
    }
    return rows;
  }

  /** 失败／取消前只计算临时结果；完成时原子发布文档、选区和唯一历史游标。 */
  async jumpToHistory(position: number, options: ImageEditHistoryJumpOptionsV3 = {}): Promise<boolean> {
    this.assertMutable();
    if (this.historyJumpActive) throw new Error('正在恢复历史，请等待完成或取消后重试');
    if (position === this.getHistoryView().position) return false;
    this.historyJumpActive = true;
    historyLogger.info('开始恢复图片历史', { event: 'image_edit.history.jump.start', context: { documentId: this.document.id, position } });
    try {
      const candidate = await this.evaluateHistoryPosition(position, options);
      candidate.assertCurrent();
      this.assertMutable();
      this.history.publishPosition(candidate.document, candidate.commandPosition, candidate.sourceDocument);
      this.document = candidate.document;
      this.selection = candidate.selection;
      this.selectionRevision += candidate.selectionSteps;
      this.sessionUndo = candidate.timeline.slice(0, position);
      this.sessionRedo = candidate.timeline.slice(position).reverse();
      this.previewOverrides.clear();
      this.historyGeneration++;
      if (candidate.document !== candidate.sourceDocument) this.persistChange(candidate.sourceDocument.revision);
      this.emit();
      historyLogger.info('图片历史恢复完成', { event: 'image_edit.history.jump.completed', context: { documentId: this.document.id, position } });
      return true;
    } catch (error) {
      historyLogger.warn('图片历史恢复未完成', { event: 'image_edit.history.jump.failed', error });
      throw error;
    } finally { this.historyJumpActive = false; }
  }

  /** 缩略图消费同一历史求值器；不移动游标、清除预览或触发保存。 */
  async readHistoryDocument(position: number, signal?: AbortSignal): Promise<ImageEditDocumentV3> {
    const candidate = await this.evaluateHistoryPosition(position, { signal });
    candidate.assertCurrent();
    return candidate.document;
  }

  private async evaluateHistoryPosition(position: number, options: ImageEditHistoryJumpOptionsV3) {
    const view = this.getHistoryView();
    if (!Number.isSafeInteger(position) || position < 0 || position > view.total) throw new RangeError(`历史位置必须在 0～${view.total} 之间`);
    const sourceDocument = this.document;
    const sourceSelectionRevision = this.selectionRevision;
    const sourceGeneration = this.historyGeneration;
    const timeline = [...this.sessionUndo, ...[...this.sessionRedo].reverse()];
    let document = sourceDocument;
    let selection = this.selection;
    let commandPosition = this.history.getState().undoCount;
    let selectionSteps = 0;
    const direction = position < view.position ? -1 : 1;
    const total = Math.abs(position - view.position);
    const assertCurrent = (): void => {
      options.signal?.throwIfAborted();
      this.lifecycleAbort.signal.throwIfAborted();
      if (this.document !== sourceDocument || this.selectionRevision !== sourceSelectionRevision || this.historyGeneration !== sourceGeneration) {
        throw new Error('历史已继续编辑，请重新选择要恢复的位置');
      }
    };
      assertCurrent();
      options.onProgress?.(0, total);
      await (options.yieldControl?.() ?? new Promise<void>(resolve => setTimeout(resolve, 0)));
      for (let completed = 0; completed < total; completed++) {
        assertCurrent();
        const index = direction < 0 ? view.position - completed - 1 : view.position + completed;
        const entry = timeline[index];
        if ('commandId' in entry) {
          const commandEntry = this.history.getEntryAt(direction < 0 ? commandPosition - 1 : commandPosition);
          if (commandEntry?.forward.commandId !== entry.commandId) throw new Error('文档历史与会话时间线不一致');
          const command = direction < 0 ? commandEntry.inverse : commandEntry.forward;
          document = applyImageEditCommandV3(document, withImageEditCommandRevisionV3(command, document.revision), { allowLegacyResourceMetadata: true }).document;
          commandPosition += direction;
        } else { selection = direction < 0 ? entry.before : entry.after; selectionSteps++; }
        options.onProgress?.(completed + 1, total);
        if ((completed + 1) % 16 === 0) await (options.yieldControl?.() ?? new Promise<void>(resolve => setTimeout(resolve, 0)));
      }
      assertCurrent();
      return { document, selection, timeline, commandPosition, sourceDocument, selectionSteps, assertCurrent };
  }

  subscribePersistence(listener: (snapshot: ImageEditPersistenceSnapshotV3) => void): () => void {
    this.persistenceListeners.add(listener);
    return () => this.persistenceListeners.delete(listener);
  }

  dispatch(command: ImageEditCommandV3): ImageEditDocumentV3 {
    this.assertMutable();
    const previousRevision = this.document.revision;
    const nextByteSizes = new Map(this.resourceByteSizes);
    const prepared = prepareImageEditCommandResourceMetadataV3(
      this.document,
      command,
      nextByteSizes,
    );
    for (const resource of collectPositiveImageEditCommandResourceBytesV3(prepared)) {
      const existing = nextByteSizes.get(resource.resourceId);
      if (existing !== undefined && existing !== resource.byteSize) {
        throw new Error(`图片编辑资源字节数冲突：${resource.resourceId}`);
      }
      nextByteSizes.set(resource.resourceId, resource.byteSize);
    }
    const nextDocument = this.history.execute(this.document, prepared);
    if (nextDocument === this.document) return this.document;
    this.document = nextDocument;
    this.sessionUndo.push({ commandId: prepared.commandId, projection: projectImageEditHistoryCommandV3(prepared) });
    this.historyGeneration++;
    this.sessionRedo = [];
    this.resourceByteSizes.clear();
    nextByteSizes.forEach((byteSize, resourceId) => this.resourceByteSizes.set(resourceId, byteSize));
    this.persistChange(previousRevision);
    this.flushReleasedResources();
    this.emit();
    return this.document;
  }

  setPreview(override: ImageEditPreviewOverrideV3): void {
    this.assertMutable();
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
    this.assertMutable();
    const preview = this.previewOverrides.get(id);
    if (!preview) throw new Error(`预览覆盖不存在：${id}`);
    if (preview.baseRevision !== this.document.revision) {
      this.previewOverrides.delete(id);
      throw new Error('预览覆盖对应的文档版本已经变化');
    }
    this.previewOverrides.delete(id);
    const document = this.document;
    const next = this.dispatch(command);
    if (next === document) this.emit();
    return next;
  }

  undo(): boolean {
    this.assertMutable();
    const entry = this.sessionUndo.at(-1);
    if (!entry) return false;
    if (!('commandId' in entry)) {
      this.sessionUndo.pop(); this.sessionRedo.push(entry);
      this.selection = entry.before; this.selectionRevision++; this.historyGeneration++; this.previewOverrides.clear(); this.emit(); return true;
    }
    const previousRevision = this.document.revision;
    const transition = this.history.undo(this.document);
    if (!transition.changed) return false;
    this.document = transition.document;
    this.sessionUndo.pop(); this.sessionRedo.push(entry);
    this.historyGeneration++;
    this.previewOverrides.clear();
    this.persistChange(previousRevision);
    this.flushReleasedResources();
    this.emit();
    return true;
  }

  undoCommands(commandIdsNewestFirst: readonly string[]): boolean {
    this.assertMutable();
    this.assertSessionCommandHead(commandIdsNewestFirst);
    const previousRevision = this.document.revision;
    const transition = this.history.undoCommands(this.document, commandIdsNewestFirst);
    if (!transition.changed) return false;
    this.document = transition.document;
    for (const entry of this.sessionUndo.splice(-commandIdsNewestFirst.length).reverse()) this.sessionRedo.push(entry);
    this.historyGeneration++;
    this.previewOverrides.clear();
    this.persistChange(previousRevision);
    this.flushReleasedResources();
    this.emit();
    return true;
  }

  rollbackCommands(commandIdsNewestFirst: readonly string[]): boolean {
    this.assertMutable();
    this.assertSessionCommandHead(commandIdsNewestFirst);
    const previousRevision = this.document.revision;
    const transition = this.history.rollbackCommands(this.document, commandIdsNewestFirst);
    if (!transition.changed) return false;
    this.document = transition.document;
    this.sessionUndo.splice(-commandIdsNewestFirst.length);
    this.historyGeneration++;
    this.previewOverrides.clear();
    this.persistChange(previousRevision);
    this.flushReleasedResources();
    this.emit();
    return true;
  }

  redo(): boolean {
    this.assertMutable();
    const entry = this.sessionRedo.at(-1);
    if (!entry) return false;
    if (!('commandId' in entry)) {
      this.sessionRedo.pop(); this.sessionUndo.push(entry);
      this.selection = entry.after; this.selectionRevision++; this.historyGeneration++; this.previewOverrides.clear(); this.emit(); return true;
    }
    const previousRevision = this.document.revision;
    const transition = this.history.redo(this.document);
    if (!transition.changed) return false;
    this.document = transition.document;
    this.sessionRedo.pop(); this.sessionUndo.push(entry);
    this.historyGeneration++;
    this.previewOverrides.clear();
    this.persistChange(previousRevision);
    this.flushReleasedResources();
    this.emit();
    return true;
  }

  clearHistory(): void {
    this.assertMutable();
    this.history.clear(this.document);
    this.sessionUndo = []; this.sessionRedo = [];
    this.historyGeneration++;
    this.previewOverrides.clear();
    this.persistChange(this.document.revision);
    this.flushReleasedResources();
    this.emit();
  }

  dispose(): void {
    this.disposed = true;
    this.lifecycleAbort.abort(new Error('DOCUMENT_RELEASED：图片文档实例已释放'));
    this.repository?.cancelAutosave(this.document.id);
    this.previewOverrides.clear();
    this.listeners.clear();
    this.persistenceListeners.clear();
  }

  setMutationGuard(guard: () => void): void {
    this.assertMutable();
    if (this.mutationGuard) throw new Error('图片文档命令总线已绑定运行实例');
    this.mutationGuard = guard;
  }

  /** 一次手势一个会话历史项；清理实例不落盘，也不污染作品历史。 */
  setSelection(selection: ImageEditSelectionSessionV3 | null): number | null {
    this.assertMutable();
    const after = selection === null ? null : imageEditSelectionSessionSchemaV3.parse(selection);
    if (JSON.stringify(after) === JSON.stringify(this.selection)) return null;
    const hadDocumentRedo = this.history.getState().redoCount > 0;
    const selectionCommandId = this.selectionRevision + 1;
    this.sessionUndo.push({ selectionCommandId, before: this.selection, after });
    this.historyGeneration++;
    this.sessionRedo = []; this.history.discardRedo();
    this.selection = after; this.selectionRevision++;
    if (hadDocumentRedo) this.persistChange(this.document.revision);
    this.flushReleasedResources(); this.emit();
    return selectionCommandId;
  }

  restoreSelection(expected: ImageEditSelectionSessionV3 | null, selectionCommandId: number, rollback = false): void {
    this.assertMutable();
    const entry = this.sessionUndo.at(-1);
    if (!entry || 'commandId' in entry || entry.selectionCommandId !== selectionCommandId || JSON.stringify(this.selection) !== JSON.stringify(expected)) throw new Error('选区已继续编辑，无法撤销过期事务');
    this.undo();
    if (rollback) this.sessionRedo.pop();
  }

  private assertSessionCommandHead(ids: readonly string[]): void {
    if (ids.length === 0) return;
    const actual = this.sessionUndo.slice(-ids.length).reverse();
    if (actual.length !== ids.length || actual.some((entry, index) => !('commandId' in entry) || entry.commandId !== ids[index])) {
      throw new Error('待撤销命令之后已有选区或文档编辑，请先撤销较新的操作');
    }
  }

  private assertMutable(): void {
    assertApplicationWritesAllowed();
    if (this.disposed) throw new Error('DOCUMENT_RELEASED：图片文档实例已释放');
    this.mutationGuard?.();
  }

  private persistChange(expectedRevision: number): void {
    const snapshot = this.getPersistenceSnapshot();
    this.repository?.scheduleAutosave(this.document, {
      expectedRevision,
      previewRef: null,
      history: snapshot.history,
    });
    this.onPersistentChange?.(snapshot);
    for (const listener of this.persistenceListeners) listener(snapshot);
  }

  private emit(): void {
    // 位置或分叉更新用于使面板缓存失效；预览不会创建历史项。
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  private flushReleasedResources(): void {
    if (this.history.takeReleasedResourceEvents().length === 0) return;
    const retained = collectImageEditJsonResourceIdsV3(
      this.document,
      this.history.getRetainedResources().map((resource) => resource.resourceId),
    );
    this.repository?.scheduleGarbageCollection?.(this.document.id, retained);
  }
}
