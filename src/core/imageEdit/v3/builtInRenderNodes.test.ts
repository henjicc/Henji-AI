import { describe, expect, it } from 'vitest';
import { createBuiltInImageEditRenderNodeRegistry } from './builtInRenderNodes';

describe('图片编辑 V3 内置渲染节点', () => {
  it('明确颜色、alpha、后端与失效契约', () => {
    const registry = createBuiltInImageEditRenderNodeRegistry();
    expect(registry.get('effect.gaussian-blur')).toMatchObject({
      version: 2,
      category: 'local',
      color: { input: 'linear-light', output: 'linear-light', alpha: 'premultiplied' },
      backends: ['webgpu', 'cpu-libvips'],
      invalidation: 'tile-with-halo',
    });
    expect(registry.get('effect.vgpu-glow')).toMatchObject({
      category: 'global-analysis',
      globalAnalysis: { maxEdge: 1_024, resultVersion: 4 },
      backends: ['webgpu'],
    });
  });

  it('曝光、曲线、色温色调和 HSL 可融合为点式 pass', () => {
    const registry = createBuiltInImageEditRenderNodeRegistry();
    expect(['exposure', 'curves', 'temperature-tint', 'hsl'].map((kind) => (
      registry.get(`adjustment.${kind}`)?.fusion
    ))).toEqual(['pointwise-chain', 'pointwise-chain', 'pointwise-chain', 'pointwise-chain']);
  });
});
