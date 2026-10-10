import { describe, expect, it } from 'vitest';
import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory';
import { embedImageEditRasterV3, rasterizeImageEditSmartLayerV3 } from '@/core/imageEdit/v3/smartContent/commands';
import { createFloat32PremultipliedRgbaTile } from '@/core/imageEdit/v3/effects/contracts';
import { compileImageEditorGpuRasterSceneV3 } from '../gpu/imageEditorGpuRasterSceneCompilerV3';
import { planImageEditorGpuRasterTilesV3 } from '../gpu/imageEditorGpuTilePlannerV3';
import { collectPixels } from '../export/renderExportTestFixtures';
import { compileImageEditRenderPlanV3 } from '@/core/imageEdit/v3/renderPlanCompiler';
import { createBuiltInImageEditRenderNodeRegistry } from '@/core/imageEdit/v3/builtInRenderNodes';

const cache = `sha256:${'b'.repeat(64)}` as const;
function fixture() {
  const content = createImageEditDocumentV3({ width: 2, height: 1, sourceResourceId: cache });
  const smart = embedImageEditRasterV3(content, content.layers[0].id);
  smart.source = { kind: 'empty' }; smart.tiles = { '0/0/0': cache };
  const document = createImageEditDocumentV3({ width: 4, height: 2, documentId: 'parent' });
  document.layers = [smart];
  return { smart, document };
}
describe('智能内容原生网格的共享 CPU/GPU 呈现', () => {
  it('异尺寸内容与栅格化后的 CPU 输出一致，画布外保持透明', async () => {
    const { document, smart } = fixture();
    const render = () => collectPixels(document, 16, new Map(), undefined, {
      resourceDescriptors: [{ resourceRef: cache, byteLength: 112, mediaType: 'application/x-henji-brush-tile-v3' }],
      dependencies: { readBrushTiles: async requests => ({ tiles: requests.map(({ tileKey }) => ({ tileKey,
        tile: createFloat32PremultipliedRgbaTile(2, 1, 'linear-light', Float32Array.from([1, 0, 0, 1, 0, 1, 0, 1]), 'srgb', 'srgb', 203) })) }) },
    });
    const pixels = await render();
    expect([...pixels.slice(0, 16)]).toEqual([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect([...pixels.slice(16)]).toEqual(new Array(16).fill(0));
    document.layers = [rasterizeImageEditSmartLayerV3(smart)]; expect(await render()).toEqual(pixels);
  });
  it('GPU 源场景/瓦片计划使用内容网格，内容改变只使关联源失效', () => {
    const { document, smart } = fixture();
    const result = compileImageEditorGpuRasterSceneV3(document, [{ resourceRef: cache, byteLength: 112, mediaType: 'application/x-henji-brush-tile-v3' }]);
    expect(result.supported).toBe(true); if (!result.supported) return;
    expect(result.scene.layers[0].rasterCanvasSize).toEqual({ width: 2, height: 1 });
    const plan = planImageEditorGpuRasterTilesV3(result.scene, result.scene.layers[0], { stageWidth: 4, stageHeight: 2, viewportKey: 'smart',
      viewport: { documentX: 0, documentY: 0, width: 4, height: 2, zoom: 1, devicePixelRatio: 1 } });
    expect(plan.tiles[0]).toMatchObject({ coreWidth: 2, coreHeight: 1 });
    document.layers.push({ ...structuredClone(smart), id: 'unrelated', content: { ...structuredClone(smart.content), id: 'independent' } });
    const registry = createBuiltInImageEditRenderNodeRegistry();
    const before = compileImageEditRenderPlanV3(document, registry, 'stable');
    smart.tiles = { '0/0/0': `sha256:${'c'.repeat(64)}` };
    const after = compileImageEditRenderPlanV3(document, registry, 'stable');
    const source = (plan: typeof before, id: string) => plan.nodes.find(node => node.layerId === id && node.definitionId === 'source.raster')!.subtreeHash;
    expect(source(after, smart.id)).not.toBe(source(before, smart.id));
    expect(source(after, 'unrelated')).toBe(source(before, 'unrelated'));
  });
});
