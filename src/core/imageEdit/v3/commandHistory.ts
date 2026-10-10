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
  IMAGE_EDIT_HISTORY_LEGACY_SNAPSHOT_VERSION_V3,
  IMAGE_EDIT_HISTORY_SNAPSHOT_VERSION_V3,
  stringifyImageEditCommandHistorySnapshotV3,
  type DecodeImageEditHistorySnapshotOptionsV3,
  type ImageEditCommandHistorySnapshotV3,
  type ImageEditHistoryEntrySnapshotV3,
} from './commandHistoryCodec';
import type { ImageEditDocumentV3 } from './documentTypes';
import { serializeImageEditRenderValue, type ImageEditHashValue } from './renderHash';
import { decodeImageEditRuntimeHistoryV3 } from './historyPaging/runtimeSnapshot';
import type { ImageEditHistoryCheckpointV3 } from './historyPaging/schema';

export type ImageEditHistoryResourceReleaseReasonV3 =
  | 'redo-cleared'
  | 'rollback'
  | 'clear'
  | 'restore';

export interface ImageEditHistoryResourcesReleasedEventV3 {
  reason: ImageEditHistoryResourceReleaseReasonV3;
  resources: ImageEditHistoryResourceReferenceV3[];
}

export interface ImageEditCommandHistoryOptionsV3 {
  readPage?: (checkpoint: ImageEditHistoryCheckpointV3, pageIndex: number, signal?: AbortSignal) => Promise<ImageEditHistoryEntrySnapshotV3[]>;
  maxSnapshotJsonBytes?: number;
  onResourcesReleased?: (event: ImageEditHistoryResourcesReleasedEventV3) => void;
}

export interface ImageEditCommandHistoryStateV3 {
  undoCount: number;
  redoCount: number;
  retainedBytes: number | null;
  retainedResourceCount: number;
  retainedResourceBytes: number | null;
  unknownResourceCount: number;
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

function sumKnownResources(resources: readonly ImageEditHistoryResourceReferenceV3[]): {
  bytes: number;
  unknownResourceCount: number;
} {
  let total = 0;
  let unknownResourceCount = 0;
  for (const resource of resources) {
    if (resource.byteSize !== null) total += resource.byteSize;
    else unknownResourceCount += 1;
    if (!Number.isSafeInteger(total)) throw new RangeError('历史资源字节数溢出');
  }
  return { bytes: total, unknownResourceCount };
}

function hasStrictResourceMetadata(command: ImageEditCommandV3): boolean {
  if (command.type === 'document.atomic') return command.commands.every(hasStrictResourceMetadata);
  if (command.type === 'layer.add'
    || command.type === 'layer.delete'
    || command.type === 'layer.duplicate'
    || command.type === 'layer.group'
    || command.type === 'layer.ungroup') return command.resources !== undefined;
  if (command.type === 'layer.set-mask') {
    return command.maskResources !== undefined && command.previousMaskResources !== undefined;
  }
  return true;
}

function commandChangesState(forward: ImageEditCommandV3, inverse: ImageEditCommandV3): boolean {
  if (forward.type !== inverse.type) return true;
  const { commandId: _id, expectedRevision: _revision, ...after } = forward;
  const { commandId: _inverseId, expectedRevision: _inverseRevision, ...before } = inverse;
  return serializeImageEditRenderValue(JSON.parse(JSON.stringify(after)) as ImageEditHashValue)
    !== serializeImageEditRenderValue(JSON.parse(JSON.stringify(before)) as ImageEditHashValue);
}

/**
 * 命令历史只保存正向命令、逆向补丁和资源哈希/大小，不嵌入像素。
 * 一个命令就是一个历史单位；画笔手势应在结束时提交单个 tile-delta 命令。
 */
export class ImageEditCommandHistoryV3 {
  private readonly maxSnapshotJsonBytes: number | undefined;
  private readonly onResourcesReleased: ImageEditCommandHistoryOptionsV3['onResourcesReleased'];
  private readonly undoEntries: ImageEditHistoryEntrySnapshotV3[] = [];
  private readonly redoEntries: ImageEditHistoryEntrySnapshotV3[] = [];
  private readonly releaseEvents: ImageEditHistoryResourcesReleasedEventV3[] = [];
  private documentId: string | null = null;
  private headRevision: number | null = null;
  private cold: ImageEditCommandHistorySnapshotV3['cold'];
  private readonly pages = new Map<number, ImageEditHistoryEntrySnapshotV3[]>();
  private readonly readPage: ImageEditCommandHistoryOptionsV3['readPage'];
  private pageRead: Promise<unknown> = Promise.resolve();

  constructor(options: ImageEditCommandHistoryOptionsV3 = {}) {
    this.maxSnapshotJsonBytes = options.maxSnapshotJsonBytes === undefined
      ? undefined
      : validateLimit(options.maxSnapshotJsonBytes, '历史快照 JSON 上限');
    this.onResourcesReleased = options.onResourcesReleased;
    this.readPage = options.readPage;
  }

  execute(document: ImageEditDocumentV3, command: ImageEditCommandV3): ImageEditDocumentV3 {
    this.assertHead(document);
    if (this.allEntries().some((entry) => entry.forward.commandId === command.commandId)
      || this.cold?.commandIds.slice(0, this.cold.prefixLength).includes(command.commandId)) {
      throw new ImageEditCommandValidationErrorV3(`历史命令 ID 重复：${command.commandId}`);
    }
    const retainedBefore = this.resourceMap();
    const hadRedo = this.getState().redoCount > 0;
    const result = applyImageEditCommandV3(document, command);
    // 无变化的手势／参数提交不推进 revision、不分叉 redo，也不留下空历史。
    if (!commandChangesState(command, result.inverse)) return document;
    const releaseCandidates = this.mergeResourceMap(retainedBefore, result.historyResources);
    this.redoEntries.length = 0;
    if (this.cold) this.cold = { ...this.cold, prefixLength: Math.min(this.cold.position, this.cold.prefixLength), position: this.cold.position + 1 };
    this.undoEntries.push(cloneEntry({
      forward: command,
      inverse: result.inverse,
      metadataBytes: result.historyMetadataBytes,
      resources: result.historyResources,
    }));
    this.track(result.document);
    if (hadRedo) this.notifyReleased(releaseCandidates, 'redo-cleared');
    return result.document;
  }

  undo(document: ImageEditDocumentV3): ImageEditHistoryTransitionV3 {
    this.assertHead(document);
    const position = this.getState().undoCount;
    const entry = this.getEntryAt(position - 1);
    if (!entry && position > 0) throw new Error('历史冷页尚未加载，请使用异步历史导航');
    if (!entry) return { document, changed: false };
    const command = withImageEditCommandRevisionV3(entry.inverse, document.revision);
    const result = applyImageEditCommandV3(document, command, { allowLegacyResourceMetadata: true });
    if (this.cold && position <= this.cold.prefixLength) this.cold = { ...this.cold, position: position - 1 };
    else {
      this.undoEntries.pop(); this.redoEntries.push(entry);
      if (this.cold) this.cold = { ...this.cold, position: position - 1 };
    }
    this.track(result.document);
    return { document: result.document, changed: true };
  }

  /**
   * 仅当撤销栈顶部仍是调用方刚写入的命令时执行。用户或另一个入口已经继续编辑后会拒绝，
   * 避免补偿/撤销误伤较新的真实操作。
   */
  undoCommands(
    document: ImageEditDocumentV3,
    commandIdsNewestFirst: readonly string[]
  ): ImageEditHistoryTransitionV3 {
    this.assertHead(document);
    if (commandIdsNewestFirst.length === 0) return { document, changed: false };
    const position = this.getState().undoCount;
    const actual = commandIdsNewestFirst.map((_, index) => this.getEntryAt(position - 1 - index)?.forward.commandId);
    if (
      actual.length !== commandIdsNewestFirst.length
      || actual.some((commandId, index) => commandId !== commandIdsNewestFirst[index])
    ) {
      throw new ImageEditRevisionConflictErrorV3('待撤销的图片编辑命令已不是历史栈顶部');
    }
    let current = document;
    for (const _commandId of commandIdsNewestFirst) {
      const transition = this.undo(current);
      if (!transition.changed) {
        throw new ImageEditRevisionConflictErrorV3('图片编辑历史不足，无法安全撤销');
      }
      current = transition.document;
    }
    return { document: current, changed: true };
  }

  /**
   * 事务补偿专用：先按同样的栈顶 CAS 撤销，再丢弃由补偿产生的 redo 项。
   * 失败事务不能留在用户的重做历史里，否则一次普通“重做”会把已回滚的半成品重新写回。
   */
  rollbackCommands(
    document: ImageEditDocumentV3,
    commandIdsNewestFirst: readonly string[]
  ): ImageEditHistoryTransitionV3 {
    const retainedBefore = this.resourceMap();
    if (this.cold && commandIdsNewestFirst.length > this.undoEntries.length) {
      // 事务命令可已确认入冷页；先验证整组，再截去回滚尾部。
      if (this.getState().redoCount > 0) throw new ImageEditRevisionConflictErrorV3('事务回滚期间存在较新的重做分支');
      const transition = this.undoCommands(document, commandIdsNewestFirst);
      if (!transition.changed) return transition;
      this.redoEntries.length = 0;
      this.cold = { ...this.cold, prefixLength: Math.min(this.cold.position, this.cold.prefixLength) };
      this.notifyReleased(retainedBefore, 'rollback');
      return transition;
    }
    const transition = this.undoCommands(document, commandIdsNewestFirst);
    if (!transition.changed) return transition;
    const rolledBack = this.redoEntries.splice(-commandIdsNewestFirst.length);
    const actual = rolledBack.map((entry) => entry.forward.commandId);
    if (
      actual.length !== commandIdsNewestFirst.length
      || actual.some((commandId, index) => commandId !== commandIdsNewestFirst[index])
    ) {
      throw new ImageEditRevisionConflictErrorV3('事务回滚产生了不匹配的重做历史');
    }
    this.notifyReleased(retainedBefore, 'rollback');
    return transition;
  }

  redo(document: ImageEditDocumentV3): ImageEditHistoryTransitionV3 {
    this.assertHead(document);
    const position = this.getState().undoCount;
    const entry = this.getEntryAt(position);
    if (!entry && this.getState().redoCount > 0) throw new Error('历史冷页尚未加载，请使用异步历史导航');
    if (!entry) return { document, changed: false };
    const command = withImageEditCommandRevisionV3(entry.forward, document.revision);
    const result = applyImageEditCommandV3(document, command, { allowLegacyResourceMetadata: true });
    if (this.cold && position < this.cold.prefixLength) this.cold = { ...this.cold, position: position + 1 };
    else {
      this.redoEntries.pop(); this.undoEntries.push(entry);
      if (this.cold) this.cold = { ...this.cold, position: position + 1 };
    }
    this.track(result.document);
    return { document: result.document, changed: true };
  }

  /** 有界投影／跳转读取，不为面板克隆整份持久快照。 */
  getEntryAt(position: number): ImageEditHistoryEntrySnapshotV3 | undefined {
    if (!Number.isSafeInteger(position) || position < 0) return undefined;
    if (this.cold) {
      if (position < this.cold.prefixLength) {
        const index = this.cold.checkpoint.pages.findIndex(page => position >= page.start && position < page.start + page.count);
        return this.pages.get(index)?.[position - this.cold.checkpoint.pages[index].start];
      }
      position -= this.cold.prefixLength;
    }
    return position < this.undoEntries.length ? this.undoEntries[position]
      : this.redoEntries[this.redoEntries.length - 1 - (position - this.undoEntries.length)];
  }

  async readEntryAt(position: number, signal?: AbortSignal): Promise<ImageEditHistoryEntrySnapshotV3 | undefined> {
    signal?.throwIfAborted();
    const cached = this.getEntryAt(position);
    if (cached || !this.cold || position < 0 || position >= this.cold.prefixLength) return cached;
    const cold = this.cold;
    const pageIndex = cold.checkpoint.pages.findIndex(page => position >= page.start && position < page.start + page.count);
    const run = async (): Promise<ImageEditHistoryEntrySnapshotV3 | undefined> => {
      signal?.throwIfAborted();
      const cached = this.getEntryAt(position);
      if (cached) return cached;
      if (!this.readPage) throw new Error('图片历史分页读取端口不可用');
      const entries = await this.readPage(cold.checkpoint, pageIndex, signal);
      signal?.throwIfAborted();
      const descriptor = cold.checkpoint.pages[pageIndex];
      if (entries.length !== descriptor.count || entries.some((entry, index) => entry.forward.commandId !== cold.commandIds[descriptor.start + index])) throw new Error('历史页与命令索引不一致');
      if (this.cold?.checkpoint !== cold.checkpoint) {
        // 保存确认只改变存储身份时，读到的同一命令仍可借阅；不能把旧页放入新窗口。
        const offset = position - descriptor.start;
        if (this.cold?.commandIds[position] === entries[offset]?.forward.commandId) return entries[offset];
        throw new Error('历史检查点已变化，请重试读取');
      }
      this.pages.delete(pageIndex); this.pages.set(pageIndex, entries);
      // 四页/16MiB 热窗口；超大合法单页独占窗口，串行读取限制在途峰值。
      while (this.pages.size > 1 && (this.pages.size > 4 || [...this.pages.keys()].reduce((sum, key) => sum + cold.checkpoint.pages[key].byteSize, 0) > 16 * 1024 * 1024)) this.pages.delete(this.pages.keys().next().value!);
      return entries[position - descriptor.start];
    };
    const operation = this.pageRead.then(run, run);
    this.pageRead = operation.then(() => undefined, () => undefined);
    return operation;
  }

  getColdCommandIds(): readonly string[] { return this.cold?.commandIds.slice(0, this.cold.prefixLength) ?? []; }
  getHotPageCount(): number { return this.pages.size; }

  /** 总线已逐命令验证临时结果后，一次发布历史游标；不创建另一撤销栈。 */
  publishPosition(document: ImageEditDocumentV3, position: number, expectedHead: ImageEditDocumentV3): void {
    this.assertHead(expectedHead);
    const state = this.getState();
    const total = state.undoCount + state.redoCount;
    if (!Number.isSafeInteger(position) || position < 0 || position > total || document.id !== expectedHead.id) {
      throw new ImageEditCommandValidationErrorV3('历史位置无效');
    }
    const tailPosition = Math.max(0, position - (this.cold?.prefixLength ?? 0));
    if (tailPosition < this.undoEntries.length) {
      while (this.undoEntries.length > tailPosition) this.redoEntries.push(this.undoEntries.pop()!);
    } else if (tailPosition > this.undoEntries.length) {
      while (this.undoEntries.length < tailPosition) this.undoEntries.push(this.redoEntries.pop()!);
    }
    if (this.cold) this.cold = { ...this.cold, position };
    this.track(document);
  }

  clear(document?: ImageEditDocumentV3): void {
    const retainedBefore = this.resourceMap();
    this.undoEntries.length = 0;
    this.redoEntries.length = 0;
    this.cold = undefined; this.pages.clear();
    this.documentId = document?.id ?? null;
    this.headRevision = document?.revision ?? null;
    this.notifyReleased(retainedBefore, 'clear');
  }

  discardRedo(): void {
    const retainedBefore = this.resourceMap();
    this.redoEntries.length = 0;
    if (this.cold) this.cold = { ...this.cold, prefixLength: Math.min(this.cold.position, this.cold.prefixLength) };
    this.notifyReleased(retainedBefore, 'redo-cleared');
  }

  createSnapshot(): ImageEditCommandHistorySnapshotV3 {
    if (this.documentId === null || this.headRevision === null) {
      throw new ImageEditRevisionConflictErrorV3('历史尚未绑定图片文档');
    }
    const entries = this.allEntries();
    const strict = entries.every((entry) => (
      entry.resources.every((resource) => resource.byteSize !== null)
      && hasStrictResourceMetadata(entry.forward)
      && hasStrictResourceMetadata(entry.inverse)
    ));
    return {
      version: this.cold?.checkpoint.snapshotVersion ?? (strict
        ? IMAGE_EDIT_HISTORY_SNAPSHOT_VERSION_V3
        : IMAGE_EDIT_HISTORY_LEGACY_SNAPSHOT_VERSION_V3),
      documentId: this.documentId,
      headRevision: this.headRevision,
      undo: this.undoEntries.map(cloneEntry),
      redo: this.redoEntries.map(cloneEntry),
      ...(this.cold ? { cold: this.cold } : {}),
    };
  }

  stringifySnapshot(): string {
    return stringifyImageEditCommandHistorySnapshotV3(this.createSnapshot(), this.decodeOptions());
  }

  restore(document: ImageEditDocumentV3, value: unknown): void {
    const decoded = { snapshot: value && typeof value === 'object' && 'cold' in value
      ? decodeImageEditRuntimeHistoryV3(value) : decodeImageEditCommandHistorySnapshotV3(value, this.decodeOptions()).snapshot };
    if (decoded.snapshot.documentId !== document.id || decoded.snapshot.headRevision !== document.revision) {
      throw new ImageEditRevisionConflictErrorV3(
        `历史快照头不匹配：快照 ${decoded.snapshot.documentId}@${decoded.snapshot.headRevision}，文档 ${document.id}@${document.revision}`
      );
    }
    if (!decoded.snapshot.cold) this.assertSnapshotApplies(document, decoded.snapshot);
    const retainedBefore = this.resourceMap();
    this.undoEntries.length = 0;
    this.redoEntries.length = 0;
    this.cold = decoded.snapshot.cold; this.pages.clear();
    for (const entry of decoded.snapshot.undo) this.undoEntries.push(cloneEntry(entry));
    for (const entry of decoded.snapshot.redo) this.redoEntries.push(cloneEntry(entry));
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
    const resourceTotals = sumKnownResources(resources);
    const retainedMetadataBytes = sumMetadata(entries);
    const retainedBytes = resourceTotals.unknownResourceCount > 0
      ? null
      : retainedMetadataBytes + resourceTotals.bytes;
    return {
      undoCount: this.cold?.position ?? this.undoEntries.length,
      redoCount: this.cold ? this.cold.prefixLength + this.undoEntries.length + this.redoEntries.length - this.cold.position : this.redoEntries.length,
      retainedBytes,
      retainedResourceCount: resources.length,
      retainedResourceBytes: resourceTotals.unknownResourceCount > 0
        ? null
        : resourceTotals.bytes,
      unknownResourceCount: resourceTotals.unknownResourceCount,
    };
  }

  private allEntries(): ImageEditHistoryEntrySnapshotV3[] {
    return [...this.undoEntries, ...this.redoEntries];
  }

  private resourceMap(): Map<string, ImageEditHistoryResourceReferenceV3> {
    const merged = mergeImageEditHistoryResourceReferencesV3(
      [...(this.cold?.checkpoint.resources ?? []), ...(this.cold?.checkpoint.pages.map(page => ({ resourceId: page.resourceId, byteSize: page.byteSize })) ?? []), ...this.allEntries().flatMap((entry) => entry.resources)]
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
        { allowLegacyResourceMetadata: true },
      ).document;
    }
    let redoDocument = document;
    for (let index = snapshot.redo.length - 1; index >= 0; index -= 1) {
      const entry = snapshot.redo[index];
      if (!entry) continue;
      redoDocument = applyImageEditCommandV3(
        redoDocument,
        withImageEditCommandRevisionV3(entry.forward, redoDocument.revision),
        { allowLegacyResourceMetadata: true },
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
