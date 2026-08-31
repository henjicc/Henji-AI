import pixelmatch from 'pixelmatch';
import { describe, expect, it } from 'vitest';

import {
  createImageEditAnnotationLayerV3,
  createImageEditDocumentV3,
  createImageEditEffectLayerV3,
  createImageEditRasterLayerV3,
} from '../documentFactory';
import { createBuiltInImageEditRenderNodeRegistry } from '../builtInRenderNodes';
import { createFloat32PremultipliedRgbaTile } from '../effects';
import { compileImageEditRenderPlanV3 } from '../renderPlanCompiler';
import { executeImageEditCpuRenderPlanV3 } from './cpuRenderPlanExecutor';

const SOURCE = createFloat32PremultipliedRgbaTile(3, 1, 'linear-light', Float32Array.from([
  0, 0, 0, 1,
  0, 0, 0, 1,
  0, 0, 0, 1,
]));
const CENTER_MARK = createFloat32PremultipliedRgbaTile(3, 1, 'linear-light', Float32Array.from([
  0, 0, 0, 0,
  1, 1, 1, 1,
  0, 0, 0, 0,
]));
const BLURRED_MARK_GOLDEN = Uint8Array.from([
  58, 58, 58, 255,
  127, 127, 127, 255,
  58, 58, 58, 255,
]);

function toRgba8(data: Float32Array): Uint8Array {
  return Uint8Array.from(data, (value) => Math.round(Math.max(0, Math.min(1, value)) * 255));
}

async function render(quality: 'stable' | 'export'): Promise<Uint8Array> {
  const document = createImageEditDocumentV3({ width: 3, height: 1, documentId: 'pixel-golden' });
  document.layers = [
    createImageEditRasterLayerV3('source', 'source', 'sha256:source'),
    createImageEditAnnotationLayerV3('marks', 'marks'),
    createImageEditEffectLayerV3('blur', 'blur', 'image.gaussian-blur-v2', {
      radius: 0.8,
      mip: 0,
    }),
  ];
  const output = await executeImageEditCpuRenderPlanV3(
    compileImageEditRenderPlanV3(document, createBuiltInImageEditRenderNodeRegistry(), quality),
    {
      loadRaster: async () => SOURCE,
      rasterizeAnnotations: async () => CENTER_MARK,
    },
  );
  if (!output) throw new Error('Expected rendered output');
  return toRgba8(output.data);
}

describe('图片编辑 V3 像素金样', () => {
  it('标注下方模糊的稳定预览与导出保持同一像素语义', async () => {
    const preview = await render('stable');
    const exported = await render('export');
    expect(pixelmatch(preview, BLURRED_MARK_GOLDEN, undefined, 3, 1, { threshold: 0.01 })).toBe(0);
    expect(pixelmatch(exported, BLURRED_MARK_GOLDEN, undefined, 3, 1, { threshold: 0.01 })).toBe(0);
    expect(pixelmatch(preview, exported, undefined, 3, 1, { threshold: 0 })).toBe(0);
  });
});
