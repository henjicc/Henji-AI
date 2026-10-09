import { evaluateRegionProgram, type RegionGrid, type RegionProgram, type RegionRect } from '@/core/imaging/regions';
import { quickMaskRegionProgram } from './regionAdapter';
import type { MaskEditorDocument } from './types';

export type MaskRegionWorkerRequest = { kind: 'document'; document: MaskEditorDocument }
  | { kind: 'read'; id: number; grid: RegionGrid; region: RegionRect };
export type MaskRegionWorkerResponse = { id: number; data: Float32Array } | { id: number; error: string };

let program: RegionProgram = { operations: [], feather: 0, inverted: false };
let failure: string | null = null;
globalThis.onmessage = (event: MessageEvent<MaskRegionWorkerRequest>): void => {
  const request = event.data;
  if (request.kind === 'document') {
    try { program = quickMaskRegionProgram(request.document); failure = null; }
    catch (error) { failure = error instanceof Error ? error.message : String(error); }
    return;
  }
  try {
    if (failure) throw new Error(failure);
    const data = evaluateRegionProgram(program, request.grid, request.region);
    globalThis.postMessage({ id: request.id, data } satisfies MaskRegionWorkerResponse, { transfer: [data.buffer] });
  } catch (error) {
    globalThis.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) } satisfies MaskRegionWorkerResponse);
  }
};
