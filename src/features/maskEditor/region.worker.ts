import { type RegionGrid, type RegionRect } from '@/core/imaging/regions';
import { quickMaskRegionProgram, evaluateQuickMaskProgram, type QuickMaskPaintProgram } from './regionAdapter';
import type { MaskEditorDocument } from './types';

export type MaskRegionWorkerRequest = { kind: 'document'; document: MaskEditorDocument }
  | { kind: 'read'; id: number; grid: RegionGrid; region: RegionRect };
export type MaskRegionWorkerResponse = { id: number; data: Float32Array } | { id: number; error: string };

let program: QuickMaskPaintProgram | null = null;
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
    if (!program) throw new Error('遮罩文档未载入');
    const data = evaluateQuickMaskProgram(program, request.region, request.grid);
    globalThis.postMessage({ id: request.id, data } satisfies MaskRegionWorkerResponse, { transfer: [data.buffer] });
  } catch (error) {
    globalThis.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) } satisfies MaskRegionWorkerResponse);
  }
};
