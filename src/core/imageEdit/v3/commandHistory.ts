import {
  withImageEditCommandRevisionV3,
  mergeImageEditHistoryResourceReferencesV3,
  type ImageEditCommandV3,
  type ImageEditHistoryResourceReferenceV3,
} from './commandTypes';
import {
  applyImageEditCommandV3,
  ImageEditCommandValidationErrorV3,
  ImageEditRevisionConflictErrorV3,
} from './commandReducer';
import {
  decodeImageEditCommandHistorySnapshotV3,
  IMAGE_EDIT_HISTORY_SNAPSHOT_VERSION_V3,
  stringifyImageEditCommandHistorySnapshotV3,
  type DecodeImageEditHistorySnapshotOptionsV3,
  type ImageEditCommandHistorySnapshotV3,
  type ImageEditHistoryEntrySnapshotV3,
} from './commandHistoryCodec';
import type { ImageEditDocumentV3 } from './documentTypes';

export const IMAGE_EDIT_HISTORY_DEFAULT_MAX_COMMANDS_V3 = 200;
export const IMAGE_EDIT_HISTORY_DEFAULT_MAX_BYTES_V3 = 2 * 1024 * 1024 * 1024;

export type ImageEditHistoryResourceReleaseReasonV3 =
  | 'prune'
  | 'redo-cleared'
  | 'clear'
  | 'restore';

export interface ImageEditHistoryResourcesReleasedEventV3 {
  reason: ImageEditHistoryResourceReleaseReasonV3;
  resources: ImageEditHistoryResourceReferenceV3[];
}

export interface ImageEditCommandHistoryOptionsV3 {
  maxCommands?: number;
  maxBytes?: number;
  maxSnapshotJsonBytes?: number;
  onResourcesReleased?: (event: ImageEditHistoryResourcesReleasedEventV3) => void;
}

export interface ImageEditCommandHistoryStateV3 {
  undoCount: number;
  redoCount: number;
  retainedBytes: number;
  retainedResourceCount: number;
  retainedResourceBytes: number;
  maxCommands: number;
  maxBytes: number;
}

export interface ImageEditHistoryTransitionV3 {
  document: ImageEditDocumentV3;
  changed: boolean;
}

function validateLimit(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label}必须是非负安全整数`);
  return value;
}

function cloneEntry(entry: ImageEditHistoryEntrySnapshotV3): ImageEditHistoryEntrySnapshotV3 {
  return JSON.parse(JSON.stringify(entry)) as ImageEditHistoryEntrySnapshotV3;
}

function sumMetadata(entries: readonly ImageEditHistoryEntrySnapshotV3[]): number {
  let total = 0;
  for (const entry of entries) {
    total += entry.metadataBytes;
    if (!Number.isSafeInteger(total)) throw new RangeError('历史元数据字节数溢出');
  }
  return total;
}

function sumKnownResources(resources: readonly ImageEditHistoryResourceReferenceV3[]): number {
  let total = 0;
  for (const resource of resources) {
    if (resource.byteSize !== null) total += resource.byteSize;
    if (!Number.isSafeInteger(total)) throw new RangeError('历史资源字节数溢出');
  }
  return total;
}

/**
 * 命令历史只保存正向命令、逆向补丁和资源哈希/大小，不嵌入像素。
 * 一个命令就是一个历史单位；画笔手势应在结束时提交单个 tile-delta 命令。
 */
export class ImageEditCommandHistoryV3 {
  private readonly maxCommands: number;
  private readonly maxBytes: number;
  private readonly maxSnapshotJsonBytes: number | undefined;
  private readonly onResourcesReleased: ImageEditCommandHistoryOptionsV3['onResourcesReleased'];
  private readonly undoEntries: ImageEditHistoryEntrySnapshotV3[] = [];
  private readonly redoEntries: ImageEditHistoryEntrySnapshotV3[] = [];
  private readonly releaseEvents: ImageEditHistoryResourcesReleasedEventV3[] = [];
  private documentId: string | null = null;
  private headRevision: number | null = null;

  constructor(options: ImageEditCommandHistoryOptionsV3 = {}) {
    this.maxCommands = validateLimit(
      options.maxCommands ?? IMAGE_EDIT_HISTORY_DEFAULT_MAX_COMMANDS_V3,
      '历史命令上限'
    );
    this.maxBytes = validateLimit(
      options.maxBytes ?? IMAGE_EDIT_HISTORY_DEFAULT_MAX_BYTES_V3,
      '历史字节上限'
    );
    this.maxSnapshotJsonBytes = options.maxSnapshotJsonBytes === undefined
      ? undefined
      : validateLimit(options.maxSnapshotJsonBytes, '历史快照 JSON 上限');
    this.onResourcesReleased = options.onResourcesReleased;
  }

  execute(document: ImageEditDocumentV3, command: ImageEditCommandV3): ImageEditDocumentV3 {
    this.assertHead(document);
    if (this.allEntries().some((entry) => entry.forward.commandId === command.commandId)) {
      throw new ImageEditCommandValidationErrorV3(`历史命令 ID 重复：${command.commandId}`);
    }
    const retainedBefore = this.resourceMap();
    const hadRedo = this.redoEntries.length > 0;
    const result = applyImageEditCommandV3(document, command);
    const releaseCandidates = this.mergeResourceMap(retainedBefore, result.historyResources);
    this.redoEntries.length = 0;
    this.undoEntries.push(cloneEntry({
      forward: command,
      inverse: result.inverse,
      metadataBytes: result.historyMetadataBytes,
      resources: result.historyResources,
    }));
    const pruned = this.pruneOldest();
    this.track(result.document);
    if (hadRedo || pruned) {
      this.notifyReleased(releaseCandidates, hadRedo ? 'redo-cleared' : 'prune');
    }
    return result.document;
  }

  undo(document: ImageEditDocumentV3): ImageEditHistoryTransitionV3 {
    this.assertHead(document);
    const entry = this.undoEntries.pop();
    if (!entry) return { document, changed: false };
    const command = withImageEditCommandRevisionV3(entry.inverse, document.revision);
    const result = applyImageEditCommandV3(document, command);
    this.redoEntries.push(entry);
    this.track(result.document);
    return { document: result.document, changed: true };
  }

  redo(document: ImageEditDocumentV3): ImageEditHistoryTransitionV3 {
    this.assertHead(document);
    const entry = this.redoEntries.pop();
    if (!entry) return { document, changed: false };
    const command = withImageEditCommandRevisionV3(entry.forward, document.revision);
    const result = applyImageEditCommandV3(document, command);
    this.undoEntries.push(entry);
    this.track(result.document);
    return { document: result.document, changed: true };
  }

  clear(document?: ImageEditDocumentV3): void {
    const retainedBefore = this.resourceMap();
    this.undoEntries.length = 0;
    this.redoEntries.length = 0;
    this.documentId = document?.id ?? null;
    this.headRevision = document?.revision ?? null;
    this.notifyReleased(retainedBefore, 'clear');
  }

  createSnapshot(): ImageEditCommandHistorySnapshotV3 {
    if (this.documentId === null || this.headRevision === null) {
      throw new ImageEditRevisionConflictErrorV3('历史尚未绑定图片文档');
    }
    return {
      version: IMAGE_EDIT_HISTORY_SNAPSHOT_VERSION_V3,
      documentId: this.documentId,
      headRevision: this.headRevision,
      undo: this.undoEntries.map(cloneEntry),
      redo: this.redoEntries.map(cloneEntry),
    };
  }

  stringifySnapshot(): string {
    return stringifyImageEditCommandHistorySnapshotV3(this.createSnapshot(), this.decodeOptions());
  }

  restore(document: ImageEditDocumentV3, value: unknown): void {
    const decoded = decodeImageEditCommandHistorySnapshotV3(value, this.decodeOptions());
    if (decoded.snapshot.documentId !== document.id || decoded.snapshot.headRevision !== document.revision) {
      throw new ImageEditRevisionConflictErrorV3(
        `历史快照头不匹配：快照 ${decoded.snapshot.documentId}@${decoded.snapshot.headRevision}，文档 ${document.id}@${document.revision}`
      );
    }
    this.assertSnapshotApplies(document, decoded.snapshot);
    const retainedBefore = this.resourceMap();
    this.undoEntries.splice(0, this.undoEntries.length, ...decoded.snapshot.undo.map(cloneEntry));
    this.redoEntries.splice(0, this.redoEntries.length, ...decoded.snapshot.redo.map(cloneEntry));
    this.track(document);
    this.notifyReleased(retainedBefore, 'restore');
  }

  getRetainedResources(): ImageEditHistoryResourceReferenceV3[] {
    return [...this.resourceMap().values()].map((resource) => ({ ...resource }));
  }

  takeReleasedResourceEvents(): ImageEditHistoryResourcesReleasedEventV3[] {
    return this.releaseEvents.splice(0).map((event) => ({
      reason: event.reason,
      resources: event.resources.map((resource) => ({ ...resource })),
    }));
  }

  getState(): ImageEditCommandHistoryStateV3 {
    const entries = this.allEntries();
    const resources = this.getRetainedResources();
    const retainedResourceBytes = sumKnownResources(resources);
    return {
      undoCount: this.undoEntries.length,
      redoCount: this.redoEntries.length,
      retainedBytes: sumMetadata(entries) + retainedResourceBytes,
      retainedResourceCount: resources.length,
      retainedResourceBytes,
      maxCommands: this.maxCommands,
      maxBytes: this.maxBytes,
    };
  }

  private allEntries(): ImageEditHistoryEntrySnapshotV3[] {
    return [...this.undoEntries, ...this.redoEntries];
  }

  private resourceMap(): Map<string, ImageEditHistoryResourceReferenceV3> {
    const merged = mergeImageEditHistoryResourceReferencesV3(
      this.allEntries().flatMap((entry) => entry.resources)
    );
    return new Map(merged.map((resource) => [resource.resourceId, resource]));
  }

  private mergeResourceMap(
    current: ReadonlyMap<string, ImageEditHistoryResourceReferenceV3>,
    added: readonly ImageEditHistoryResourceReferenceV3[],
  ): Map<string, ImageEditHistoryResourceReferenceV3> {
    const merged = mergeImageEditHistoryResourceReferencesV3([...current.values(), ...added]);
    return new Map(merged.map((resource) => [resource.resourceId, resource]));
  }

  private pruneOldest(): boolean {
    let pruned = false;
    while (
      this.undoEntries.length + this.redoEntries.length > this.maxCommands
      || this.getState().retainedBytes > this.maxBytes
    ) {
      const removed = this.undoEntries.shift();
      if (!removed) break;
      pruned = true;
    }
    return pruned;
  }

  private notifyReleased(
    retainedBefore: ReadonlyMap<string, ImageEditHistoryResourceReferenceV3>,
    reason: ImageEditHistoryResourceReleaseReasonV3,
  ): void {
    if (retainedBefore.size === 0) return;
    const retainedAfter = this.resourceMap();
    const resources = [...retainedBefore.values()]
      .filter((resource) => !retainedAfter.has(resource.resourceId))
      .map((resource) => ({ ...resource }));
    if (resources.length === 0) return;
    const event = { reason, resources } satisfies ImageEditHistoryResourcesReleasedEventV3;
    this.releaseEvents.push(event);
    try {
      this.onResourcesReleased?.({ reason, resources: resources.map((resource) => ({ ...resource })) });
    } catch {
      // 释放通知不能回滚已经成功的文档命令；事件仍可由 takeReleasedResourceEvents 重试。
    }
  }

  private decodeOptions(): DecodeImageEditHistorySnapshotOptionsV3 {
    return {
      maxCommands: this.maxCommands,
      maxBytes: this.maxBytes,
      ...(this.maxSnapshotJsonBytes === undefined ? {} : { maxJsonBytes: this.maxSnapshotJsonBytes }),
    };
  }

  /**
   * 结构校验之外，还要证明两条可达路径都能从当前文档执行：撤销栈从新到旧应用
   * inverse，重做栈从栈顶到栈底应用 forward。这样被替换但形状仍合法的补丁不会
   * 等到用户重启后第一次撤销时才暴露。
   */
  private assertSnapshotApplies(
    document: ImageEditDocumentV3,
    snapshot: ImageEditCommandHistorySnapshotV3,
  ): void {
    let undoDocument = document;
    for (let index = snapshot.undo.length - 1; index >= 0; index -= 1) {
      const entry = snapshot.undo[index];
      if (!entry) continue;
      undoDocument = applyImageEditCommandV3(
        undoDocument,
        withImageEditCommandRevisionV3(entry.inverse, undoDocument.revision),
      ).document;
    }
    let redoDocument = document;
    for (let index = snapshot.redo.length - 1; index >= 0; index -= 1) {
      const entry = snapshot.redo[index];
      if (!entry) continue;
      redoDocument = applyImageEditCommandV3(
        redoDocument,
        withImageEditCommandRevisionV3(entry.forward, redoDocument.revision),
      ).document;
    }
  }

  private assertHead(document: ImageEditDocumentV3): void {
    if (this.documentId === null || this.headRevision === null) {
      this.track(document);
      return;
    }
    if (document.id !== this.documentId || document.revision !== this.headRevision) {
      throw new ImageEditRevisionConflictErrorV3(
        `历史头不匹配：期望 ${this.documentId}@${this.headRevision}，实际 ${document.id}@${document.revision}`
      );
    }
  }

  private track(document: ImageEditDocumentV3): void {
    this.documentId = document.id;
    this.headRevision = document.revision;
  }
}
