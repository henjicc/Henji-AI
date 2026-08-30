import { describe, expect, it } from 'vitest';
import { createDefaultImageEditColorModeV3 } from './colorTypes';
import type { ImageEditDocumentV3 } from './documentTypes';
import {
  createImageEditLayerCommonV3,
  type ImageEditAdjustmentLayerV3,
  type ImageEditAnnotationLayerV3,
  type ImageEditEffectLayerV3,
  type ImageEditGroupLayerV3,
  type ImageEditRasterLayerV3,
  type ImageEditLayerV3,
} from './layerTypes';
import { createBuiltInImageEditRenderNodeRegistry } from './builtInRenderNodes';
import { compileImageEditRenderPlanV3 } from './renderPlanCompiler';

function baseLayer(): ImageEditRasterLayerV3 {
  return {
    ...createImageEditLayerCommonV3('base', '原图'),
    type: 'raster',
    source: { kind: 'resource', resourceId: 'sha256:source' },
    tiles: {},
  };
}

function annotationLayer(): ImageEditAnnotationLayerV3 {
  return {
    ...createImageEditLayerCommonV3('annotations', '标注'),
    type: 'annotation',
    annotations: [{
      id: 'mark', type: 'text', x: 10, y: 20, text: 'A', color: 'red', fontSize: 24,
    }],
  };
}

function blurLayer(): ImageEditEffectLayerV3 {
  return {
    ...createImageEditLayerCommonV3('blur', '模糊'),
    type: 'effect', effectId: 'image.blur', renderable: true,
    params: { radiusPixels: 18 },
  };
}

function adjustment(id: string, adjustmentId: string): ImageEditAdjustmentLayerV3 {
  return {
    ...createImageEditLayerCommonV3(id, adjustmentId),
    type: 'adjustment', adjustmentId, renderable: true, params: {},
  };
}

function document(layers: ImageEditLayerV3[]): ImageEditDocumentV3 {
  return {
    version: 3,
    id: 'doc',
    revision: 1,
    geometry: {
      width: 1_000,
      height: 800,
      orientation: { rotate: 0, mirrored: false },
      crop: null,
    },
    color: createDefaultImageEditColorModeV3(),
    layers,
  };
}

describe('图片编辑 V3 有序 RenderPlan', () => {
  const registry = createBuiltInImageEditRenderNodeRegistry();

  it('模糊位于标注上方时处理已合成标注', () => {
    const plan = compileImageEditRenderPlanV3(
      document([baseLayer(), annotationLayer(), blurLayer()]), registry, 'stable',
    );
    expect(plan.layerEvaluationOrder).toEqual(['base', 'annotations', 'blur']);
    const blurNode = plan.nodes.find((node) => node.layerId === 'blur');
    const annotationComposite = plan.nodes.filter((node) => node.layerId === 'annotations').at(-1);
    expect(blurNode?.inputNodeIds).toEqual([annotationComposite?.id]);
  });

  it('标注位于模糊上方时保持清晰，且重排改变输出身份', () => {
    const blurredAnnotation = compileImageEditRenderPlanV3(
      document([baseLayer(), annotationLayer(), blurLayer()]), registry, 'stable',
    );
    const clearAnnotation = compileImageEditRenderPlanV3(
      document([baseLayer(), blurLayer(), annotationLayer()]), registry, 'stable',
    );
    const blurNode = clearAnnotation.nodes.find((node) => node.layerId === 'blur');
    const baseComposite = clearAnnotation.nodes.filter((node) => node.layerId === 'base').at(-1);
    expect(blurNode?.inputNodeIds).toEqual([baseComposite?.id]);
    expect(clearAnnotation.outputHash).not.toBe(blurredAnnotation.outputHash);
  });

  it('普通全不透明无蒙版组走 pass-through，其余组隔离合成', () => {
    const passThrough: ImageEditGroupLayerV3 = {
      ...createImageEditLayerCommonV3('group-pass', '直通组'),
      type: 'group', isolated: false, children: [annotationLayer()],
    };
    const isolated: ImageEditGroupLayerV3 = {
      ...createImageEditLayerCommonV3('group-isolated', '隔离组'),
      type: 'group', isolated: true, children: [
        { ...annotationLayer(), id: 'isolated-annotation' },
        blurLayer(),
      ],
    };
    const plan = compileImageEditRenderPlanV3(
      document([baseLayer(), passThrough, isolated]), registry, 'stable',
    );
    expect(plan.nodes.some((node) => node.layerId === 'group-pass')).toBe(false);
    expect(plan.nodes.some((node) => (
      node.layerId === 'group-isolated' && node.definitionId === 'group.isolated'
    ))).toBe(true);
  });

  it('组内效果只处理同组下方兄弟，不泄漏到组外 backdrop', () => {
    const scopedGroup: ImageEditGroupLayerV3 = {
      ...createImageEditLayerCommonV3('group-scoped', '局部效果组'),
      type: 'group',
      isolated: false,
      children: [
        { ...annotationLayer(), id: 'group-annotation' },
        { ...blurLayer(), id: 'group-blur' },
      ],
    };
    const plan = compileImageEditRenderPlanV3(
      document([baseLayer(), scopedGroup]), registry, 'stable',
    );
    const blur = plan.nodes.find((node) => node.layerId === 'group-blur');
    const groupAnnotation = plan.nodes
      .filter((node) => node.layerId === 'group-annotation')
      .at(-1);

    expect(blur?.inputNodeIds).toEqual([groupAnnotation?.id]);
    expect(plan.nodes).toContainEqual(expect.objectContaining({
      layerId: 'group-scoped', definitionId: 'group.isolated',
    }));
  });

  it('连续无蒙版点式调整融合为一个 pass', () => {
    const plan = compileImageEditRenderPlanV3(document([
      baseLayer(),
      adjustment('exposure', 'exposure'),
      adjustment('curves', 'curves'),
      adjustment('hsl', 'hsl'),
    ]), registry, 'draft');
    expect(plan.passes.some((pass) => (
      pass.kind === 'fused-pointwise' && pass.nodeIds.length === 3
    ))).toBe(true);
  });

  it('未知 legacy 效果原样留在文档但不改变渲染输出', () => {
    const unknown: ImageEditEffectLayerV3 = {
      ...createImageEditLayerCommonV3('unknown', '未知效果'),
      type: 'effect', effectId: 'legacy.unknown', renderable: false, params: { x: 1 },
    };
    const withoutUnknown = compileImageEditRenderPlanV3(document([baseLayer()]), registry, 'stable');
    const withUnknown = compileImageEditRenderPlanV3(document([baseLayer(), unknown]), registry, 'stable');
    expect(withUnknown.outputHash).toBe(withoutUnknown.outputHash);
    expect(withUnknown.diagnostics).toContainEqual(expect.objectContaining({
      layerId: 'unknown', code: 'unsupported-layer',
    }));
  });
});
