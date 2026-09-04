import { describe, expect, it } from 'vitest';
import { createBuiltInImageEditRenderNodeRegistry } from './builtInRenderNodes';
import { IMAGE_EDIT_TILED_CPU_NODE_IDS_V3 } from './execution';
import {
  IMAGE_EDIT_LAYER_OPERATION_CATALOG_V3,
  listCreatableImageEditOperationIdsV3,
} from './operationCatalog';

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
    const fastBlur = registry.get('effect.fast-blur');
    expect(fastBlur).toMatchObject({
      version: 3,
      category: 'global-analysis',
      invalidation: 'shared-analysis',
      globalAnalysis: { maxEdge: 2_048, cacheScope: 'subtree', resultVersion: 3 },
      backends: ['webgpu', 'cpu-libvips'],
    });
    expect(fastBlur?.localHalo?.({ radius: 40 }, 0)).toBe(48);
    expect(registry.get('effect.vgpu-glow')).toMatchObject({
      category: 'global-analysis',
      globalAnalysis: { maxEdge: 1_024, resultVersion: 4 },
      backends: ['webgpu', 'cpu-libvips'],
    });
    const diffusion = registry.get('effect.diffusion');
    expect(diffusion).toMatchObject({
      version: 4,
      category: 'global-analysis',
      invalidation: 'shared-analysis',
      globalAnalysis: { maxEdge: 2_048, cacheScope: 'subtree', resultVersion: 4 },
    });
    expect(diffusion?.localHalo?.({}, 0)).toBe(3);
    const gpuPlanNodeIds = [
      'source.raster', 'vector.annotation',
      'effect.blur-v1', 'effect.gaussian-blur', 'effect.fast-blur',
      'effect.diffusion', 'effect.vgpu-glow',
      'adjustment.exposure', 'adjustment.curves',
      'adjustment.temperature-tint', 'adjustment.hsl',
      'composite.layer', 'group.isolated',
    ];
    for (const id of gpuPlanNodeIds) {
      expect(registry.get(id)?.backends, id).toContain('webgpu');
    }
  });

  it('曝光、曲线、色温色调和 HSL 可融合为点式 pass', () => {
    const registry = createBuiltInImageEditRenderNodeRegistry();
    expect(['exposure', 'curves', 'temperature-tint', 'hsl'].map((kind) => (
      registry.get(`adjustment.${kind}`)?.fusion
    ))).toEqual(['pointwise-chain', 'pointwise-chain', 'pointwise-chain', 'pointwise-chain']);
  });

  it('动态注册表中的每个节点都有 tiled CPU 执行器且操作映射无悬空项', () => {
    const registry = createBuiltInImageEditRenderNodeRegistry();
    const registeredIds = registry.list().map(({ id }) => id);
    expect([...IMAGE_EDIT_TILED_CPU_NODE_IDS_V3].sort()).toEqual([...registeredIds].sort());
    for (const operation of IMAGE_EDIT_LAYER_OPERATION_CATALOG_V3) {
      expect(registry.get(operation.renderDefinitionId), operation.operationId).not.toBeNull();
    }
    expect(listCreatableImageEditOperationIdsV3('effect')).toEqual([
      'image.fast-blur-v3',
      'image.gaussian-blur-v2',
      'image.diffusion',
      'image.vgpu-glow',
    ]);
  });
});
