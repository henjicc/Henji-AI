import { describe, expect, it } from 'vitest';

import {
  applyLayerStackDraft,
  createStableLayerId,
  createStableLayerResourceId,
  createStableLayerStackId,
  reconcileLayerStackMissingResources,
  validateLayerStackDocument,
  type LayerStackDocumentV1,
} from './layerStack';

function document(): LayerStackDocumentV1 {
  const stackId = createStableLayerStackId('completion-1');
  return {
    version: 1,
    stackId,
    status: 'ready',
    source: { capabilityId: 'image.layer-separation', sourceNodeId: 'source', inputResourceId: 'input', providerId: 'volcengine', modelId: 'seedream', completionId: 'completion-1' },
    canvas: { width: 512, height: 512, colorSpace: 'srgb', alphaMode: 'straight', compositeOperation: 'source-over', clipPolicy: 'canvas-bounds' },
    compositeResourceId: 'composite',
    thumbnailResourceId: 'thumbnail',
    layers: [
      { version: 1, layerId: createStableLayerId(stackId, 0), sourceOutputIndex: 0, providerZIndex: 0, order: 0, role: 'base', name: '底图', resourceId: createStableLayerResourceId(stackId, 0), placement: { x: 0, y: 0, width: 512, height: 512 }, opacity: 1, visible: true, blendMode: 'normal', alpha: 'opaque' },
      { version: 1, layerId: createStableLayerId(stackId, 1), sourceOutputIndex: 1, providerZIndex: 1, order: 1, role: 'content', name: '标题', resourceId: createStableLayerResourceId(stackId, 1), placement: { x: 20, y: 30, width: 100, height: 40 }, opacity: 1, visible: true, blendMode: 'normal', alpha: 'straight' },
    ],
    resources: [
      { version: 1, resourceId: createStableLayerResourceId(stackId, 0), status: 'ready', filePath: '/media/base.jpg', mimeType: 'image/jpeg', width: 512, height: 512, hasAlpha: false, byteLength: 100, sha256: 'a' },
      { version: 1, resourceId: createStableLayerResourceId(stackId, 1), status: 'ready', filePath: '/media/title.png', mimeType: 'image/png', width: 100, height: 40, hasAlpha: true, byteLength: 50, sha256: 'b' },
      { version: 1, resourceId: 'composite', status: 'ready', filePath: '/media/composite.png', mimeType: 'image/png', width: 512, height: 512, hasAlpha: true, byteLength: 120, sha256: 'c' },
      { version: 1, resourceId: 'thumbnail', status: 'ready', filePath: '/media/thumb.webp', mimeType: 'image/webp', width: 256, height: 256, hasAlpha: false, byteLength: 40, sha256: 'd' },
    ],
  };
}

describe('layerStack V1', () => {
  it('稳定派生 ID 并接受合法的 bottom-to-top 文档', () => {
    expect(createStableLayerStackId('completion-1')).toBe(createStableLayerStackId('completion-1'));
    expect(validateLayerStackDocument(document()).layers).toHaveLength(2);
  });

  it('拒绝不连续顺序、重复来源、内容层无 alpha 与未知混合模式', () => {
    const source = document();
    expect(() => validateLayerStackDocument({ ...source, layers: source.layers.map((layer, index) => ({ ...layer, order: index + 1 })) })).toThrow(/连续/);
    expect(() => validateLayerStackDocument({ ...source, layers: source.layers.map((layer) => ({ ...layer, sourceOutputIndex: 0 })) })).toThrow(/重复/);
    expect(() => validateLayerStackDocument({ ...source, resources: source.resources.map((resource) => resource.resourceId.endsWith(':1') ? { ...resource, hasAlpha: false } : resource) })).toThrow(/透明通道/);
    expect(() => validateLayerStackDocument({ ...source, layers: source.layers.map((layer, index) => index ? { ...layer, blendMode: 'multiply' as 'normal' } : layer) })).toThrow(/normal/);
  });

  it('拒绝不稳定 ID、缺失合成引用、错误底图尺寸与伪降级状态', () => {
    const source = document();
    expect(() => validateLayerStackDocument({ ...source, stackId: 'unstable' })).toThrow(/completionId/);
    expect(() => validateLayerStackDocument({ ...source, compositeResourceId: 'missing' })).toThrow(/合成资源/);
    expect(() => validateLayerStackDocument({ ...source, layers: source.layers.map((layer) => layer.role === 'base' ? { ...layer, placement: { ...layer.placement, width: 511 } } : layer) })).toThrow(/资源不一致|覆盖画布/);
    expect(() => validateLayerStackDocument({ ...source, status: 'degraded' })).toThrow(/必须包含缺失资源/);
  });

  it('缺失资源保留结构并降级，不删除图层', () => {
    const degraded = reconcileLayerStackMissingResources(document(), new Set(['/media/base.jpg', '/media/composite.png', '/media/thumb.webp']));
    expect(degraded.status).toBe('degraded');
    expect(degraded.layers).toHaveLength(2);
    expect(degraded.resources.find((item) => item.resourceId.endsWith(':1'))).toMatchObject({ status: 'missing', filePath: null });
  });

  it('草稿确认原子写入顺序、显隐和透明度，非法草稿不污染原文档', () => {
    const source = document();
    const next = applyLayerStackDraft(source, source.layers.map((layer) => ({ layerId: layer.layerId, visible: layer.role === 'base', opacity: layer.role === 'base' ? 1 : 0.4 })), source.layers.map((layer) => layer.layerId));
    expect(next.layers[1]).toMatchObject({ visible: false, opacity: 0.4 });
    expect(source.layers[1].opacity).toBe(1);
    expect(() => applyLayerStackDraft(source, [], [])).toThrow(/不完整/);
  });
});
