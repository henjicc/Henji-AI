import { createSeamPlan, type SeamPlan } from '@/core/imaging/transforms/seam';
import { reduceSeamAnalysisTile, seamSourceRegion, sampleSeamRegion, type ProxyContribution } from '@/core/imaging/transforms/seam/sampling';
import type { EvaluationContext } from '@/core/imaging/evaluation';
import type { RegionRect, RegionGrid } from '@/core/imaging/regions';
import type { ImageEditSelectionSessionV3 } from '@/core/imageEdit/v3/selection/session';
import { rasterizeImageEditSessionRegionV3 } from '@/core/imageEdit/v3/selection/sessionRaster';

export type GeometryWorkerRequest =
  | { kind: 'reduce'; data: Float32Array; region: RegionRect; source: RegionGrid; proxy: RegionGrid; protect: ImageEditSelectionSessionV3 | null }
  | { kind: 'plan'; data: Float32Array; source: RegionGrid; output: RegionGrid; context: EvaluationContext; protect: Float32Array }
  | { kind: 'linear'; source: RegionGrid }
  | { kind: 'bounds'; output: RegionGrid; source: RegionGrid; region: RegionRect }
  | { kind: 'sample'; output: RegionGrid; source: RegionGrid; region: RegionRect; sourceRect: RegionRect; pixels?: Float32Array; selection?: ImageEditSelectionSessionV3 };
export type GeometryWorkerValue = ProxyContribution | SeamPlan | RegionRect | Float32Array;
export function createGeometryWorkerOperations(): (request: GeometryWorkerRequest, progress?: (completed: number, total: number) => void) => GeometryWorkerValue {
  let plan: SeamPlan | null = null;
  return (request, onProgress) => {
    if (request.kind === 'linear') { plan = { width: 2, height: 2, sourceWidth: request.source.width, sourceHeight: request.source.height,
      coordinates: Float32Array.of(.25, .25, .75, .25, .25, .75, .75, .75), identity: 'linear', protectedFraction: 0 }; return plan; }
    if (request.kind === 'reduce') return reduceSeamAnalysisTile(request.data, request.region, request.source, request.proxy,
      request.protect ? rasterizeImageEditSessionRegionV3(request.protect, request.source, request.region) : undefined);
    if (request.kind === 'plan') { plan = createSeamPlan({ ...request.source, originX: 0, originY: 0, data: request.data }, request.output,
      { context: request.context, protect: request.protect, onProgress }); return plan; }
    if (!plan) throw new Error('请先计算内容识别缩放预览');
    if (request.kind === 'bounds') return seamSourceRegion(plan, request.output, request.region, request.source);
    const pixels = request.selection ? rasterizeImageEditSessionRegionV3(request.selection, request.source, request.sourceRect) : request.pixels;
    if (!pixels) throw new Error('缩放来源像素缺失');
    return sampleSeamRegion(plan, request.output, request.region, request.source, request.sourceRect, pixels, request.selection ? 1 : 4, plan.identity === 'linear' ? 'transparent' : 'clamp');
  };
}
const scope = globalThis as unknown as { onmessage: ((event: MessageEvent<GeometryWorkerRequest>) => void) | null; postMessage: (value: unknown) => void };
const operations = createGeometryWorkerOperations();
scope.onmessage = event => {
  try { const value = operations(event.data, (completed, total) => scope.postMessage({ kind: 'progress', completed, total })); scope.postMessage({ kind: 'result', value }); }
  catch (error) { scope.postMessage({ kind: 'error', error: error instanceof Error ? error.message : String(error) }); }
};
