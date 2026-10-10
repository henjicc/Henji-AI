import type { GeometryWorkerRequest, GeometryWorkerValue } from './geometry.worker';
export class GeometryWorkerClient {
  private worker: Worker | null = null;
  private rejectPending: ((reason: Error) => void) | null = null;
  async run<T extends GeometryWorkerValue>(request: GeometryWorkerRequest, signal: AbortSignal, onProgress?: (completed: number, total: number) => void): Promise<T> {
    signal.throwIfAborted(); if (this.rejectPending) throw new Error('尺寸计算必须串行');
    this.worker ??= new Worker(new URL('./geometry.worker.ts', import.meta.url), { type: 'module' });
    const worker = this.worker;
    return new Promise<T>((resolve, reject) => {
      const cleanup = () => { this.rejectPending = null; signal.removeEventListener('abort', abort); worker.onmessage = null; worker.onerror = null; };
      const fail = (reason: Error) => { cleanup(); reject(reason); };
      const abort = () => { fail(new Error('CANCELLED')); this.dispose(); };
      this.rejectPending = fail; signal.addEventListener('abort', abort, { once: true });
      worker.onerror = event => { fail(new Error(event.message)); this.dispose(); };
      worker.onmessage = (event: MessageEvent<{ kind: 'result'; value: T } | { kind: 'error'; error: string } | { kind: 'progress'; completed: number; total: number }>) => {
        if (event.data.kind === 'progress') { try { onProgress?.(event.data.completed, event.data.total); } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); this.dispose(); } return; }
        cleanup(); if (event.data.kind === 'error') reject(new Error(event.data.error)); else resolve(event.data.value);
      };
      try { worker.postMessage(request); } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
    });
  }
  dispose(): void { this.rejectPending?.(new Error('CANCELLED')); this.rejectPending = null; this.worker?.terminate(); this.worker = null; }
}
