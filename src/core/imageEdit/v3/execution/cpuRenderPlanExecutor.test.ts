import { describe, expect, it } from 'vitest';
import {
  createImageEditAnnotationLayerV3,
  createImageEditAdjustmentLayerV3,
  createImageEditDocumentV3,
  createImageEditEffectLayerV3,
  createImageEditGroupLayerV3,
  createImageEditRasterLayerV3,
} from '../documentFactory';
import { createBuiltInImageEditRenderNodeRegistry } from '../builtInRenderNodes';
import { createFloat32MaskTile, createFloat32PremultipliedRgbaTile } from '../effects';
import type { ImageEditDocumentV3 } from '../documentTypes';
import type { ImageEditLayerV3 } from '../layerTypes';
import { compileImageEditRenderPlanV3 } from '../renderPlanCompiler';
import { executeImageEditCpuRenderPlanV3 } from './cpuRenderPlanExecutor';

function tile(width: number, values: readonly number[]) {
  return createFloat32PremultipliedRgbaTile(
    width,
    1,
    'linear-light',
    Float32Array.from(values),
  );
}

function document(layers: ImageEditLayerV3[], width = 3): ImageEditDocumentV3 {
  return { ...createImageEditDocumentV3({ width, height: 1, documentId: 'render-document' }), layers };
}

const black3 = tile(3, [
  0, 0, 0, 1,
  0, 0, 0, 1,
  0, 0, 0, 1,
]);
const centerMark = tile(3, [
  0, 0, 0, 0,
  1, 1, 1, 1,
  0, 0, 0, 0,
]);

async function render(documentValue: ImageEditDocumentV3) {
  const plan = compileImageEditRenderPlanV3(
    documentValue,
    createBuiltInImageEditRenderNodeRegistry(),
    'stable',
  );
  return executeImageEditCpuRenderPlanV3(plan, {
    loadRaster: async () => black3,
    rasterizeAnnotations: async () => centerMark,
  });
}

describe('V3 CPU RenderPlan 执行器', () => {
  it('真实执行图层顺序：标注在模糊下方会被模糊，在上方保持清晰', async () => {
    const source = createImageEditRasterLayerV3('source', '原图', 'sha256:source');
    const marks = createImageEditAnnotationLayerV3('marks', '标注');
    const blur = createImageEditEffectLayerV3(
      'blur',
      '高斯模糊',
      'image.gaussian-blur-v2',
      { radius: 0.8, mip: 0 },
    );

    const blurredMarks = await render(document([source, marks, blur]));
    expect(blurredMarks).not.toBeNull();
    expect(blurredMarks?.data[0]).toBeGreaterThan(0);
    expect(blurredMarks?.data[4]).toBeLessThan(1);

    const clearMarks = await render(document([source, blur, marks]));
    expect(clearMarks?.data[0]).toBeCloseTo(0, 6);
    expect(clearMarks?.data[4]).toBeCloseTo(1, 6);
    expect(clearMarks?.data[8]).toBeCloseTo(0, 6);
  });

  it('效果蒙版在原结果和处理结果间混合，且只应用一次', async () => {
    const source = createImageEditRasterLayerV3('source', '原图', 'sha256:source');
    const exposure = {
      ...createImageEditAdjustmentLayerV3('exposure', '曝光', 'exposure', {
        stops: 1,
        offset: 0,
        gamma: 1,
      }),
      mask: { resourceId: 'sha256:mask', inverted: false },
    };
    const input = tile(2, [0.25, 0.25, 0.25, 1, 0.25, 0.25, 0.25, 1]);
    const plan = compileImageEditRenderPlanV3(
      document([source, exposure], 2),
      createBuiltInImageEditRenderNodeRegistry(),
      'stable',
    );
    const result = await executeImageEditCpuRenderPlanV3(plan, {
      loadRaster: async () => input,
      rasterizeAnnotations: async () => { throw new Error('unexpected annotation'); },
      loadMask: async () => createFloat32MaskTile(2, 1, Float32Array.from([0, 1])),
    });
    expect(result?.data[0]).toBeCloseTo(0.25, 6);
    expect(result?.data[4]).toBeCloseTo(0.5, 6);
  });

  it('隔离组不透明度只在组边界应用一次', async () => {
    const source = createImageEditRasterLayerV3('source', '原图', 'sha256:source');
    const child = createImageEditAnnotationLayerV3('child', '白色标注');
    const group = {
      ...createImageEditGroupLayerV3('group', '隔离组'),
      isolated: true,
      opacity: 0.5,
      children: [child],
    };
    const sourceBlack = tile(1, [0, 0, 0, 1]);
    const white = tile(1, [1, 1, 1, 1]);
    const plan = compileImageEditRenderPlanV3(
      document([source, group], 1),
      createBuiltInImageEditRenderNodeRegistry(),
      'stable',
    );
    const result = await executeImageEditCpuRenderPlanV3(plan, {
      loadRaster: async () => sourceBlack,
      rasterizeAnnotations: async () => white,
    });
    expect(result?.data[0]).toBeCloseTo(0.5, 6);
    expect(result?.data[3]).toBeCloseTo(1, 6);
  });

  it('在节点边界协作取消，不继续执行后续图层', async () => {
    const controller = new AbortController();
    const source = createImageEditRasterLayerV3('source', '原图', 'sha256:source');
    const marks = createImageEditAnnotationLayerV3('marks', '标注');
    const plan = compileImageEditRenderPlanV3(
      document([source, marks]),
      createBuiltInImageEditRenderNodeRegistry(),
      'draft',
    );
    let annotations = 0;
    await expect(executeImageEditCpuRenderPlanV3(plan, {
      signal: controller.signal,
      loadRaster: async () => { controller.abort(); return black3; },
      rasterizeAnnotations: async () => { annotations += 1; return centerMark; },
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(annotations).toBe(0);
  });
});
