import { describe, expect, it, vi } from 'vitest';
import { readRegionSource, staticRegionContext } from '@/core/imaging/regions';
import { imageEditLayerMaskRegionSource } from './layerMask';
import { createFloat32MaskTile } from '@/core/imageEdit/v3/effects/contracts';
import { quickMaskRegionProgram, rasterizeQuickMaskCoverage } from '@/features/maskEditor/regionAdapter';
import { rasterizeImageEditSessionRegionV3 } from '@/core/imageEdit/v3/selection/sessionRaster';
import { createEmptyMaskDocument } from '@/features/maskEditor/maskDocument';

describe('参数与图层蒙版同核', () => {
  it('参数矩形与图片选区同覆盖，物化到稀疏蒙版后浮点逐位回读', async () => {
    const document = { ...createEmptyMaskDocument('source', 4, 2), strokes: [{ id: 'rect', kind: 'rectangle' as const, mode: 'paint' as const,
      points: [{ x: 0.25, y: 0 }, { x: 2.25, y: 2 }] }] };
    const region = { x: 0, y: 0, width: 4, height: 2 };
    const coverage = rasterizeQuickMaskCoverage(document, region);
    const program = quickMaskRegionProgram(document);
    const first = program.operations[0];
    if (first.kind !== 'region') throw new Error('fixture');
    const selection = { ...first.program, operations: [{ shape: first.program.operations[0].shape, combine: 'replace' as const }] };
    // Here the shape is a rectangle; compressed/brush adaptation is covered by the core suite.
    const shape = selection.operations[0].shape;
    if (shape.type !== 'rectangle') throw new Error('fixture');
    expect(coverage).toEqual(rasterizeImageEditSessionRegionV3({ ...selection, operations: [{ shape, combine: 'replace', invertBefore: false }] }, document, region));
    const load = vi.fn(async () => createFloat32MaskTile(4, 2, coverage));
    const source = imageEditLayerMaskRegionSource({ kind: 'sparse-mask', storage: 'mask-float32', maskId: 'mask', tileSize: 512,
      defaultValue: 1, inverted: false, tiles: { '0/0/0': 'float-resource' } }, document, load);
    expect((await readRegionSource(source, region, staticRegionContext(document, 'v1'))).data).toEqual(coverage);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
