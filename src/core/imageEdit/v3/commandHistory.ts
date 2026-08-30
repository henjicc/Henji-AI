import {
  withImageEditCommandRevisionV3,
  type ImageEditCommandV3,
} from './commandTypes';
import {
  applyImageEditCommandV3,
  ImageEditRevisionConflictErrorV3,
} from './commandReducer';
import type { ImageEditDocumentV3 } from './documentTypes';

export const IMAGE_EDIT_HISTORY_DEFAULT_MAX_COMMANDS_V3 = 200;
export const IMAGE_EDIT_HISTORY_DEFAULT_MAX_BYTES_V3 = 2 * 1024 * 1024 * 1024;

export interface ImageEditCommandHistoryOptionsV3 {
  maxCommands?: number;
  maxBytes?: number;
}

export interface ImageEditCommandHistoryStateV3 {
  undoCount: number;
  redoCount: number;
  retainedBytes: number;
  maxCommands: number;
  maxBytes: number;
}

export interface ImageEditHistoryTransitionV3 {
  document: ImageEditDocumentV3;
  changed: boolean;
}

interface ImageEditHistoryEntryV3 {
  forward: ImageEditCommandV3;
  inverse: ImageEditCommandV3;
  bytes: number;
}

function validateLimit(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label}必须是非负安全整数`);
  return value;
}

/**
 * 命令历史只保存正向命令、逆向补丁和瓦片哈希引用。
 * 一个命令就是一个历史单位；画笔手势应在结束时提交单个 tile-delta 命令。
 */
export class ImageEditCommandHistoryV3 {
  private readonly maxCommands: number;
  private readonly maxBytes: number;
  private readonly undoEntries: ImageEditHistoryEntryV3[] = [];
  private readonly redoEntries: ImageEditHistoryEntryV3[] = [];
  private retainedBytes = 0;
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
  }

  execute(document: ImageEditDocumentV3, command: ImageEditCommandV3): ImageEditDocumentV3 {
    this.assertHead(document);
    const result = applyImageEditCommandV3(document, command);
    if (this.redoEntries.length > 0) {
      this.retainedBytes -= this.redoEntries.reduce((sum, entry) => sum + entry.bytes, 0);
      this.redoEntries.length = 0;
    }
    this.undoEntries.push({ forward: command, inverse: result.inverse, bytes: result.historyBytes });
    this.retainedBytes += result.historyBytes;
    this.pruneOldest();
    this.track(result.document);
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
    this.undoEntries.length = 0;
    this.redoEntries.length = 0;
    this.retainedBytes = 0;
    this.documentId = document?.id ?? null;
    this.headRevision = document?.revision ?? null;
  }

  getState(): ImageEditCommandHistoryStateV3 {
    return {
      undoCount: this.undoEntries.length,
      redoCount: this.redoEntries.length,
      retainedBytes: this.retainedBytes,
      maxCommands: this.maxCommands,
      maxBytes: this.maxBytes,
    };
  }

  private pruneOldest(): void {
    while (
      this.undoEntries.length > this.maxCommands
      || this.retainedBytes > this.maxBytes
    ) {
      const removed = this.undoEntries.shift();
      if (!removed) break;
      this.retainedBytes -= removed.bytes;
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
