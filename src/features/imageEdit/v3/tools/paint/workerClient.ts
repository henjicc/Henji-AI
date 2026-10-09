import type { PaintBrush, PaintDab, PaintFill, PaintSurface, PaintTarget } from '@/core/imaging/paint';
import type { PaintWorkerRequest, PaintWorkerResponse } from './paint.worker';

/** A gesture/task owns one lazy Worker. Requests are bounded to one sparse tile. */
export class PaintWorkerClient {
  private worker: Worker | null = null;
  private busy = false;
  private closed = false;
  private rejectPending: ((reason: Error) => void) | null = null;

  rasterize = async (surface: PaintSurface, dabs: readonly PaintDab[], brush: PaintBrush, target: PaintTarget, tool: 'brush' | 'eraser', signal: AbortSignal): Promise<boolean> =>
    this.run(surface, { kind: 'dabs', surface, dabs, brush, target, tool }, signal);

  fill(surface: PaintSurface, fill: PaintFill, opacity: number, mask: boolean, signal: AbortSignal): Promise<boolean> {
    return this.run(surface, { kind: 'fill', surface, fill, opacity, mask }, signal);
  }

  private async run(surface: PaintSurface, request: PaintWorkerRequest, signal: AbortSignal): Promise<boolean> {
    signal.throwIfAborted();
    if (this.closed || this.busy) throw new Error('绘画计算已关闭或正在处理');
    this.busy = true;
    try {
      this.worker ??= new Worker(new URL('./paint.worker.ts', import.meta.url), { type: 'module' });
      const worker = this.worker;
      return await new Promise<boolean>((resolve, reject) => {
        const cleanup = (): void => { worker.onmessage = null; worker.onerror = null; signal.removeEventListener('abort', abort); this.rejectPending = null; };
        const fail = (reason: Error): void => { cleanup(); reject(reason); };
        const abort = (): void => this.dispose();
        this.rejectPending = fail;
        signal.addEventListener('abort', abort, { once: true });
        worker.onerror = event => { fail(new Error(event.message)); this.dispose(); };
        worker.onmessage = (event: MessageEvent<PaintWorkerResponse>): void => {
          cleanup();
          if ('error' in event.data) { reject(new Error(event.data.error)); return; }
          surface.output.set(event.data.output); surface.coverage.set(event.data.coverage);
          resolve(event.data.changed);
        };
        try { worker.postMessage(request); } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
      });
    } finally { this.busy = false; }
  }

  dispose(): void {
    this.closed = true; this.worker?.terminate(); this.worker = null;
    this.rejectPending?.(new Error('绘画已取消')); this.rejectPending = null;
  }
}
