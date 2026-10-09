import type { Coverage, RegionRect, RegionSnapshot } from '@/core/imaging/regions';
import type { SelectionPixels } from '@/core/imaging/regions/selectionAlgorithms';
import type { AdvancedSelectionHostMessage, AdvancedSelectionRequest, AdvancedSelectionWorkerMessage } from './protocol';

export interface AdvancedSelectionReadPort {
  read(region: RegionRect, pixels: boolean, signal: AbortSignal): Promise<{ value: Coverage | SelectionPixels; premultiplied?: boolean }>;
}
export function runAdvancedSelectionWorker(request: AdvancedSelectionRequest, reader: AdvancedSelectionReadPort, signal: AbortSignal, onProgress?: (completed: number, total: number) => void, createWorker = () => new Worker(new URL('./selectionAdvanced.worker.ts', import.meta.url), { type: 'module' })): Promise<RegionSnapshot> {
  signal.throwIfAborted();
  const worker = createWorker();
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (value: RegionSnapshot | Error): void => {
      if (finished) return;
      finished = true; signal.removeEventListener('abort', abort); worker.terminate();
      worker.onmessage = null; worker.onerror = null;
      if (value instanceof Error) reject(value); else resolve(value);
    };
    const abort = (): void => finish(new Error('CANCELLED'));
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = event => finish(new Error(event.message || '选区计算失败，请重试'));
    worker.onmessage = (event: MessageEvent<AdvancedSelectionWorkerMessage>) => {
      if (finished) return;
      const message = event.data;
      if (message.kind === 'error') finish(new Error(message.message));
      else if (message.kind === 'result') { if (signal.aborted) abort(); else finish(message.snapshot); }
      else if (message.kind === 'progress') onProgress?.(message.completed, message.total);
      else void reader.read(message.region, message.pixels, signal).then(result => {
        if (finished || signal.aborted) return;
        worker.postMessage({ kind: 'read-result', id: message.id, ...result } satisfies AdvancedSelectionHostMessage, [result.value.data.buffer as ArrayBuffer]);
      }).catch(cause => {
        if (finished || signal.aborted) return;
        try { worker.postMessage({ kind: 'read-error', id: message.id, message: cause instanceof Error ? cause.message : String(cause) } satisfies AdvancedSelectionHostMessage); }
        catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
      });
    };
    try { worker.postMessage({ kind: 'start', request } satisfies AdvancedSelectionHostMessage); }
    catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
  });
}
