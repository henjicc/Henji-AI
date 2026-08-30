import { describe, expect, it } from 'vitest';
import { createImageEditRenderHash, createImageEditTileCacheKey } from './renderHash';

describe('图片编辑 V3 渲染缓存身份', () => {
  it('对象键顺序不改变稳定哈希', () => {
    expect(createImageEditRenderHash({ a: 1, b: ['x', true] }))
      .toBe(createImageEditRenderHash({ b: ['x', true], a: 1 }));
  });

  it('设备代际、颜色模式与后端都参与瓦片缓存键', () => {
    const base = {
      sourceFingerprint: 'source',
      subtreeHash: 'tree',
      nodeVersion: 2,
      parameterHash: 'params',
      mip: 0,
      tileX: 1,
      tileY: 2,
      quality: 'stable',
      backend: 'webgpu',
      deviceGeneration: 1,
      colorMode: 'linear-rgba16float',
    };
    expect(createImageEditTileCacheKey(base)).not.toBe(createImageEditTileCacheKey({
      ...base,
      deviceGeneration: 2,
    }));
    expect(createImageEditTileCacheKey(base)).not.toBe(createImageEditTileCacheKey({
      ...base,
      colorMode: 'srgb8',
    }));
  });
});
