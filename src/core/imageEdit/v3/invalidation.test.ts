import { describe, expect, it } from 'vitest';
import { createDefaultImageEditColorModeV3 } from './colorTypes';
import type { ImageEditDocumentV3 } from './documentTypes';
import {
  createImageEditLayerCommonV3,
  type ImageEditEffectLayerV3,
  type ImageEditRasterLayerV3,
} from './layerTypes';
import { createBuiltInImageEditRenderNodeRegistry } from './builtInRenderNodes';
import { compileImageEditRenderPlanV3 } from './renderPlanCompiler';
import { computeImageEditPlanInvalidationV3 } from './invalidation';

function source(resourceId: string): ImageEditRasterLayerV3 {
  return {
    ...createImageEditLayerCommonV3('source', '原图'),
    type: 'raster', source: { kind: 'resource', resourceId }, tiles: {},
  };
}

function blur(radiusPixels: number): ImageEditEffectLayerV3 {
  return {
    ...createImageEditLayerCommonV3('blur', '模糊'),
    type: 'effect', effectId: 'image.blur', renderable: true, params: { radiusPixels },
  };
}

function glow(strength: number): ImageEditEffectLayerV3 {
  return {
    ...createImageEditLayerCommonV3('glow', '辉光 Pro'),
    type: 'effect', effectId: 'image.vgpu-glow', renderable: true, params: { strength },
  };
}

function doc(resourceId: string, radius: number, glowStrength = 1): ImageEditDocumentV3 {
  return {
    version: 3, id: 'doc', revision: 1,
    geometry: { width: 2_000, height: 1_000, orientation: { rotate: 0, mirrored: false }, crop: null },
    color: createDefaultImageEditColorModeV3(),
    layers: [source(resourceId), blur(radius), glow(glowStrength)],
  };
}

describe('图片编辑 V3 失效传播', () => {
  const registry = createBuiltInImageEditRenderNodeRegistry();

  it('局部效果扩大 dirty halo，全局效果只额外失效共享分析', () => {
    const before = compileImageEditRenderPlanV3(doc('a', 8), registry, 'stable');
    const after = compileImageEditRenderPlanV3(doc('b', 8), registry, 'stable');
    const result = computeImageEditPlanInvalidationV3(before, after, {
      kind: 'content', layerId: 'source', mip: 0,
      dirtyRect: { x: 100, y: 100, width: 20, height: 20 },
    }, registry);
    expect(result.dirtyRect).toEqual({ x: 76, y: 76, width: 68, height: 68 });
    expect(result.invalidatedAnalysisNodeIds).toHaveLength(1);
    expect(result.retainedUnderlyingCaches).toBe(true);
  });

  it('只改变裁剪窗口时保留全部底层缓存', () => {
    const plan = compileImageEditRenderPlanV3(doc('a', 8), registry, 'stable');
    expect(computeImageEditPlanInvalidationV3(plan, plan, { kind: 'crop' }, registry))
      .toEqual({
        invalidatedNodeIds: [], dirtyRect: null, invalidatedAnalysisNodeIds: [],
        retainedUnderlyingCaches: true,
      });
  });
});
