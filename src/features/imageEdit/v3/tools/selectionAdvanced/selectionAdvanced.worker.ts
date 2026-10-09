/// <reference lib="webworker" />
import { solveSelection, modifySelection, type SelectionPixels } from '@/core/imaging/regions/selectionAlgorithms';
import type { Coverage, RegionRect } from '@/core/imaging/regions';
import type { AdvancedSelectionHostMessage, AdvancedSelectionWorkerMessage } from './protocol';

const port = self as unknown as DedicatedWorkerGlobalScope;
const pending = new Map<number, { resolve: (value: SelectionPixels | Coverage) => void; reject: (error: Error) => void }>();
let sequence = 0;
function read(region: RegionRect, pixels: boolean): Promise<SelectionPixels | Coverage> {
  const id = ++sequence;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); port.postMessage({ kind: 'read', id, region, pixels } satisfies AdvancedSelectionWorkerMessage); });
}
port.onmessage = async (event: MessageEvent<AdvancedSelectionHostMessage>) => {
  const message = event.data;
  if (message.kind === 'read-result' || message.kind === 'read-error') {
    const request = pending.get(message.id); if (!request) return;
    pending.delete(message.id);
    if (message.kind === 'read-error') request.reject(new Error(message.message));
    else {
      if (message.premultiplied) for (let i = 0; i < message.value.data.length; i += 4) {
        const alpha = message.value.data[i + 3];
        for (let c = 0; c < 3; c++) message.value.data[i + c] = alpha > 0 ? message.value.data[i + c] / alpha : 0;
      }
      request.resolve(message.value);
    }
    return;
  }
  try {
    const { request } = message;
    const options = { context: request.context, onProgress: (completed: number, total: number) => port.postMessage({ kind: 'progress', completed, total } satisfies AdvancedSelectionWorkerMessage) };
    const snapshot = request.operation.kind === 'solve'
      ? await solveSelection({ grid: request.grid, read: async region => await read(region, true) as SelectionPixels }, request.operation.algorithm, options)
      : await modifySelection({ grid: request.grid, read: async region => await read(region, false) as Coverage }, request.operation.mode, request.operation.radius, options);
    port.postMessage({ kind: 'result', snapshot } satisfies AdvancedSelectionWorkerMessage, [...snapshot.tiles.values()].map(tile => tile.data.buffer as ArrayBuffer));
  } catch (cause) { port.postMessage({ kind: 'error', message: cause instanceof Error ? cause.message : String(cause) } satisfies AdvancedSelectionWorkerMessage); }
};
