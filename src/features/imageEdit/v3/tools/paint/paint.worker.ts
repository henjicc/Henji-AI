import { rasterizePaintDabs, rasterizePaintFill, type PaintBrush, type PaintDab, type PaintFill, type PaintSurface, type PaintTarget } from '@/core/imaging/paint';

export type PaintWorkerRequest = { surface: PaintSurface } & (
  { kind: 'dabs'; dabs: readonly PaintDab[]; brush: PaintBrush; target: PaintTarget; tool: 'brush' | 'eraser' }
  | { kind: 'fill'; fill: PaintFill; opacity: number; mask: boolean });
export type PaintWorkerResponse = { changed: boolean; output: Float32Array; coverage: Float32Array } | { error: string };

export function executePaintWorkerRequest(request: PaintWorkerRequest): PaintWorkerResponse {
  const surface = { ...request.surface, output: new Float32Array(request.surface.output) };
  const changed = request.kind === 'fill' ? rasterizePaintFill(surface, request.fill, request.opacity, request.mask)
    : rasterizePaintDabs(surface, request.dabs, request.brush, request.target, request.tool);
  return { changed, output: surface.output, coverage: surface.coverage };
}

if (typeof self !== 'undefined' && typeof document === 'undefined') self.onmessage = (event: MessageEvent<PaintWorkerRequest>): void => {
  try {
    const result = executePaintWorkerRequest(event.data);
    if ('error' in result) self.postMessage(result);
    else self.postMessage(result, { transfer: [result.output.buffer, result.coverage.buffer] });
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
