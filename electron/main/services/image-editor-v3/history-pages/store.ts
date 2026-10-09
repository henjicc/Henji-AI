import fsp from 'node:fs/promises';
import {
  decodeImageEditHistoryCheckpointV3, IMAGE_EDIT_HISTORY_CHECKPOINT_VERSION_V3,
  IMAGE_EDIT_HISTORY_PAGE_MAX_BYTES_V3, splitImageEditHistoryPagesV3,
  type ImageEditHistoryCheckpointV3,
} from '../../../../../src/core/imageEdit/v3/historyPaging/checkpoint';
import { decodeImageEditCommandHistorySnapshotV3, stringifyImageEditCommandHistorySnapshotV3, type ImageEditCommandHistorySnapshotV3, type ImageEditHistoryEntrySnapshotV3 } from '../../../../../src/core/imageEdit/v3/commandHistoryCodec';
import { mergeImageEditHistoryResourceReferencesV3 } from '../../../../../src/core/imageEdit/v3/commandTypes';
import type { ContentAddressedResourceStore } from '../resource-store';
import type { ResourceId, ResourceLease } from '../contracts';
import { createMainLogger } from '../../logging';

const logger = createMainLogger('main.image_editor_v3.history');

/** 保存 owner 先 prepare，再原子发布 checkpoint；确认后 release，失败不替换旧检查点。 */
export class ImageEditHistoryPageStoreV3 {
  constructor(private readonly resources: ContentAddressedResourceStore) {}

  async prepare(snapshot: ImageEditCommandHistorySnapshotV3, signal?: AbortSignal): Promise<{
    checkpoint: ImageEditHistoryCheckpointV3;
    resourceIds: ResourceId[];
    release: () => Promise<void>;
  }> {
    const leases: ResourceLease[] = [];
    const checkpoint: ImageEditHistoryCheckpointV3 = {
      format: 'henji-image-history', version: IMAGE_EDIT_HISTORY_CHECKPOINT_VERSION_V3,
      documentId: snapshot.documentId, headRevision: snapshot.headRevision, snapshotVersion: snapshot.version,
      position: snapshot.undo.length, total: snapshot.undo.length + snapshot.redo.length,
      pages: [], resources: [],
    };
    logger.info('开始保存图片历史页', { event: 'image_edit.history.pages.prepare.start', context: { documentId: snapshot.documentId } });
    const release = async (): Promise<void> => { for (const lease of leases) await lease.release(); };
    try {
      const retained = mergeImageEditHistoryResourceReferencesV3([...snapshot.undo, ...snapshot.redo].flatMap(entry => entry.resources));
      if (retained.length) leases.push(await this.resources.acquireLease(retained.map(entry => entry.resourceId as ResourceId)));
      checkpoint.resources = retained;
      let start = 0;
      for (const page of splitImageEditHistoryPagesV3(snapshot)) {
        signal?.throwIfAborted();
        const bytes = Buffer.from(stringifyImageEditCommandHistorySnapshotV3(page), 'utf8');
        const stored = await this.resources.putBuffer(bytes, { mediaType: 'application/vnd.henji.image-history+json', maxBytes: IMAGE_EDIT_HISTORY_PAGE_MAX_BYTES_V3, signal });
        leases.push(await this.resources.acquireLease([stored.id]));
        checkpoint.pages.push({ resourceId: stored.id, byteSize: stored.byteLength, start, count: page.undo.length });
        start += page.undo.length;
        // I/O 及调度按页执行；资源保留元数据不复制像素，不阻塞主进程长循环。
        await new Promise<void>(resolve => setImmediate(resolve));
      }
      signal?.throwIfAborted();
      decodeImageEditHistoryCheckpointV3(checkpoint);
      const resourceIds = [...new Set([...checkpoint.resources.map(entry => entry.resourceId), ...checkpoint.pages.map(entry => entry.resourceId)])] as ResourceId[];
      logger.info('图片历史页保存完成', { event: 'image_edit.history.pages.prepare.completed', context: { documentId: snapshot.documentId, pages: checkpoint.pages.length } });
      return { checkpoint, resourceIds, release };
    } catch (error) {
      await release();
      logger.error('图片历史页保存失败', { event: 'image_edit.history.pages.prepare.failed', error });
      throw error;
    }
  }

  async readPage(checkpointValue: unknown, pageIndex: number, signal?: AbortSignal): Promise<ImageEditHistoryEntrySnapshotV3[]> {
    const checkpoint = decodeImageEditHistoryCheckpointV3(checkpointValue);
    return this.readValidatedPage(checkpoint, pageIndex, signal);
  }

  private async readValidatedPage(checkpoint: ImageEditHistoryCheckpointV3, pageIndex: number, signal?: AbortSignal): Promise<ImageEditHistoryEntrySnapshotV3[]> {
    const descriptor = checkpoint.pages[pageIndex];
    if (!Number.isSafeInteger(pageIndex) || !descriptor) throw new RangeError('历史页不存在');
    signal?.throwIfAborted();
    const resourceId = descriptor.resourceId as ResourceId;
    const lease = await this.resources.acquireLease([resourceId]);
    try {
      const verified = await this.resources.verify(resourceId, signal);
      if (verified.byteLength !== descriptor.byteSize) throw new Error('历史页长度与检查点不一致');
      const bytes = await fsp.readFile(this.resources.getFilesystemPath(resourceId), { signal });
      const page = decodeImageEditCommandHistorySnapshotV3(bytes.toString('utf8')).snapshot;
      if (page.documentId !== 'image-history-page' || page.headRevision > checkpoint.headRevision
        || page.version !== checkpoint.snapshotVersion || page.redo.length !== 0 || page.undo.length !== descriptor.count) throw new Error('历史页内容与检查点不一致');
      const references = new Map(checkpoint.resources.map(resource => [resource.resourceId, resource.byteSize]));
      for (const entry of page.undo) for (const resource of entry.resources) {
        if (!references.has(resource.resourceId) || references.get(resource.resourceId) !== resource.byteSize) throw new Error('历史页包含未登记的资源');
      }
      signal?.throwIfAborted();
      return page.undo;
    } finally { await lease.release(); }
  }

  /** 正式打开适配口；需要全量恢复的现有同步总线按页读取，未来可直接消费 readPage。 */
  async restore(checkpointValue: unknown, signal?: AbortSignal): Promise<ImageEditCommandHistorySnapshotV3> {
    const checkpoint = decodeImageEditHistoryCheckpointV3(checkpointValue);
    const entries: ImageEditHistoryEntrySnapshotV3[] = [];
    const lease = await this.resources.acquireLease([...checkpoint.pages.map(page => page.resourceId), ...checkpoint.resources.map(entry => entry.resourceId)] as ResourceId[]);
    try {
      for (let index = 0; index < checkpoint.pages.length; index++) {
        for (const entry of await this.readValidatedPage(checkpoint, index, signal)) entries.push(entry);
        await new Promise<void>(resolve => setImmediate(resolve));
      }
      signal?.throwIfAborted();
      const snapshot: ImageEditCommandHistorySnapshotV3 = {
        version: checkpoint.snapshotVersion, documentId: checkpoint.documentId, headRevision: checkpoint.headRevision,
        undo: entries.slice(0, checkpoint.position), redo: entries.slice(checkpoint.position).reverse(),
      };
      const validated = decodeImageEditCommandHistorySnapshotV3(snapshot).snapshot;
      const retained = mergeImageEditHistoryResourceReferencesV3(entries.flatMap(entry => entry.resources));
      if (JSON.stringify(retained) !== JSON.stringify(checkpoint.resources)) throw new Error('历史页资源与检查点不一致');
      return validated;
    } finally { await lease.release(); }
  }
}
