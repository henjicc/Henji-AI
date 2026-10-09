import type { RegionGrid, RegionRect } from '@/core/imaging/regions';
import type { MaskEditorDocument } from './types';
import type { MaskRegionWorkerRequest, MaskRegionWorkerResponse } from './region.worker';

/** Host-owned worker lifecycle. Terminating a session releases compiled geometry and pending requests. */
export class MaskRegionRasterizer {
  private readonly worker = new Worker(new URL('./region.worker.ts', import.meta.url), { type: 'module' });
  private nextId = 0;
  private closed = false;
  private readonly pending = new Map<number, { resolve: (data: Float32Array) => void; reject: (error: Error) => void }>();
  private previewBusy = false;
  private previewNext: { document: MaskEditorDocument; region: RegionRect; grid: RegionGrid;
    resolve: (data: Float32Array) => void; reject: (error: Error) => void } | null = null;

  constructor(document: MaskEditorDocument) {
    this.worker.onmessage = (event: MessageEvent<MaskRegionWorkerResponse>): void => {
      const response = event.data, waiting = this.pending.get(response.id);
      this.pending.delete(response.id);
      if (!waiting) return;
      if ('error' in response) waiting.reject(new Error(response.error));
      else waiting.resolve(response.data);
    };
    this.worker.onerror = (): void => { this.dispose(new Error('遮罩求值失败，请重新打开编辑器')); };
    this.setDocument(document);
  }

  setDocument(document: MaskEditorDocument): void {
    if (this.closed) throw new Error('遮罩会话已关闭');
    this.worker.postMessage({ kind: 'document', document } satisfies MaskRegionWorkerRequest);
  }

  read(region: RegionRect, grid: RegionGrid): Promise<Float32Array> {
    if (this.closed) return Promise.reject(new Error('遮罩会话已关闭'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ kind: 'read', id, region, grid } satisfies MaskRegionWorkerRequest);
    });
  }

  /** At most one active and one latest preview: pointer updates cannot queue unbounded document clones. */
  readLatest(document: MaskEditorDocument, region: RegionRect, grid: RegionGrid): Promise<Float32Array> {
    if (this.closed) return Promise.reject(new Error('遮罩会话已关闭'));
    this.previewNext?.reject(new Error('遮罩预览已被新手势替代'));
    return new Promise((resolve, reject) => {
      this.previewNext = { document, region, grid, resolve, reject };
      this.flushPreview();
    });
  }

  private flushPreview(): void {
    const next = this.previewNext;
    if (this.previewBusy || !next || this.closed) return;
    this.previewBusy = true;
    this.previewNext = null;
    try { this.setDocument(next.document); }
    catch (error) { next.reject(error instanceof Error ? error : new Error(String(error))); this.previewBusy = false; return; }
    void this.read(next.region, next.grid).then(next.resolve, next.reject).finally(() => {
      this.previewBusy = false;
      this.flushPreview();
    });
  }

  dispose(reason = new Error('遮罩会话已取消')): void {
    this.closed = true;
    this.worker.terminate();
    for (const waiting of this.pending.values()) waiting.reject(reason);
    this.pending.clear();
    this.previewNext?.reject(reason);
    this.previewNext = null;
  }
}
