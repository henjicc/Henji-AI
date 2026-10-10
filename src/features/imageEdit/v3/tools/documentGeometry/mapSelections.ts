import type { RegionGrid, RegionRect } from '@/core/imaging/regions';
import type { ImageEditSelectionSessionV3 } from '@/core/imageEdit/v3/selection/session';
import type { ImageEditSelectionMaskShapeV3 } from '@/core/imageEdit/v3/subjectSelection';
import type { GeometryWorkerClient } from './workerClient';

/** Coverage shares the image displacement, including nonuniform brush radii and feather. */
export async function mapGeometrySelectionsV3(worker: GeometryWorkerClient, selections: readonly ImageEditSelectionSessionV3[], source: RegionGrid, output: RegionGrid, signal: AbortSignal): Promise<ImageEditSelectionSessionV3[]> {
  const sample = async (selection: ImageEditSelectionSessionV3, region: RegionRect): Promise<Float32Array> => {
    const sourceRect = await worker.run<RegionRect>({ kind: 'bounds', source, output, region }, signal);
    if (sourceRect.width * sourceRect.height * 4 > 8 * 1024 * 1024 && region.width * region.height > 1) {
      const horizontal = region.width >= region.height, split = Math.floor((horizontal ? region.width : region.height) / 2);
      const first = { ...region, ...(horizontal ? { width: split } : { height: split }) }, second = { ...region, ...(horizontal ? { x: region.x + split, width: region.width - split } : { y: region.y + split, height: region.height - split }) };
      const result = new Float32Array(region.width * region.height);
      for (const part of [first, second]) { const values = await sample(selection, part);
        for (let y = 0; y < part.height; y++) result.set(values.subarray(y * part.width, (y + 1) * part.width), (part.y - region.y + y) * region.width + part.x - region.x);
      } return result;
    }
    return worker.run<Float32Array>({ kind: 'sample', source, output, region, sourceRect, selection }, signal);
  };
  const results: ImageEditSelectionSessionV3[] = [];
  for (const selection of selections) {
    const runs: ImageEditSelectionMaskShapeV3['runs'] = [];
    for (let y = 0; y < output.height; y += 512) for (let x = 0; x < output.width; x += 512) {
      signal.throwIfAborted(); const region = { x, y, width: Math.min(512, output.width - x), height: Math.min(512, output.height - y) }, values = await sample(selection, region);
      for (let row = 0; row < region.height; row++) for (let col = 0; col < region.width;) {
        const start = col, value = values[row * region.width + col++];
        while (col < region.width && values[row * region.width + col] === value) col++;
        if (value > 0) runs.push([(region.y + row) * output.width + x + start, col - start, Math.min(1, value)]);
      }
    }
    results.push({ feather: 0, inverted: false, operations: [{ combine: 'replace', invertBefore: false, shape: { type: 'mask', ...output, matrix: [1, 0, 0, 1, 0, 0], runs: runs.sort((a, b) => a[0] - b[0]) } }] });
  } return results;
}
