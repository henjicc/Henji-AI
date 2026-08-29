import { describe, expect, it, vi } from 'vitest';

import { applyLayerStackDraft } from '../domain/layerStack';
import { prepareLayerStackDocument, recomposeLayerStackDocument } from './layerStackApplicationService';

const structuredOutput = {
  version: 1 as const,
  kind: 'layer-stack' as const,
  primary: { version: 1 as const, sourceOutputIndex: 0, url: 'https://fixtures.invalid/base.jpg', filePath: '/media/base.jpg', zIndex: 0, role: 'base' as const, width: 8, height: 8, format: 'jpeg' as const },
  outputs: [
    { version: 1 as const, sourceOutputIndex: 0, url: 'https://fixtures.invalid/base.jpg', filePath: '/media/base.jpg', zIndex: 0, role: 'base' as const, width: 8, height: 8, format: 'jpeg' as const },
    { version: 1 as const, sourceOutputIndex: 1, url: 'https://fixtures.invalid/layer.png', filePath: '/media/layer.png', zIndex: 1, role: 'content' as const, name: '主体', width: 3, height: 2, format: 'png' as const, boundingBox: { absolute: [2, 3, 5, 5] as [number, number, number, number] } },
  ],
  metadata: { colorSpace: 'srgb' as const, alphaMode: 'straight' as const, compositeOperation: 'source-over' as const, order: 'bottom-to-top' as const },
};

function composed(suffix = '1') {
  return {
    stackId: '', canvasWidth: 8, canvasHeight: 8,
    resources: [
      { sourceOutputIndex: 0, filePath: '/managed/base.jpg', mimeType: 'image/jpeg' as const, width: 8, height: 8, hasAlpha: false, byteLength: 100, sha256: 'a', placement: { x: 0, y: 0, width: 8, height: 8 } },
      { sourceOutputIndex: 1, filePath: '/managed/layer.png', mimeType: 'image/png' as const, width: 3, height: 2, hasAlpha: true, byteLength: 50, sha256: 'b', placement: { x: 2, y: 3, width: 3, height: 2 } },
    ],
    compositePath: `/managed/composite-${suffix}.png`, compositeSha256: `c${suffix}`,
    thumbnailPath: `/managed/thumb-${suffix}.webp`, thumbnailSha256: `d${suffix}`,
    thumbnailWidth: 8, thumbnailHeight: 8,
    createdFilePaths: [`/managed/composite-${suffix}.png`, `/managed/thumb-${suffix}.webp`],
  };
}

describe('layerStackApplicationService', () => {
  it('全部资源先完成主进程预验证，再建立稳定 V1 文档', async () => {
    const compose = vi.fn(async (payload) => ({ ...composed(), stackId: payload.stackId }));
    const document = await prepareLayerStackDocument({ structuredOutput, completionId: 'completion', sourceNodeId: 'source', inputResourceId: 'input', providerId: 'volcengine', modelId: 'seedream', compose });
    expect(document).toMatchObject({ status: 'ready', compositeResourceId: expect.stringContaining(':composite'), canvas: { width: 8, height: 8 } });
    expect(document.layers.map((layer) => [layer.order, layer.name, layer.resourceId])).toEqual([
      [0, '底图', expect.stringContaining(':resource:0')],
      [1, '主体', expect.stringContaining(':resource:1')],
    ]);
    expect(compose).toHaveBeenCalledWith(expect.objectContaining({ persistSourceLayers: false }));
  });

  it('未受管输出与合成数量错位均在文档创建前失败', async () => {
    await expect(prepareLayerStackDocument({ structuredOutput: { ...structuredOutput, outputs: [{ ...structuredOutput.outputs[0], filePath: undefined }] }, completionId: 'x', sourceNodeId: 's', inputResourceId: 'i', providerId: 'v', modelId: 'm', compose: vi.fn() })).rejects.toThrow(/受管落盘/);
    await expect(prepareLayerStackDocument({ structuredOutput, completionId: 'x', sourceNodeId: 's', inputResourceId: 'i', providerId: 'v', modelId: 'm', compose: async (payload) => ({ ...composed(), stackId: payload.stackId, resources: [] }) })).rejects.toThrow(/不一致/);
  });

  it('编辑草稿只在确认后重新合成并原子替换合成资源', async () => {
    const first = await prepareLayerStackDocument({ structuredOutput, completionId: 'completion', sourceNodeId: 'source', inputResourceId: 'input', providerId: 'volcengine', modelId: 'seedream', compose: async (payload) => ({ ...composed(), stackId: payload.stackId }) });
    const draft = applyLayerStackDraft(first, first.layers.map((layer) => ({ layerId: layer.layerId, visible: layer.role === 'base', opacity: layer.role === 'base' ? 1 : 0.4 })), first.layers.map((layer) => layer.layerId));
    const compose = vi.fn(async (payload) => ({ ...composed('2'), stackId: payload.stackId }));
    const next = await recomposeLayerStackDocument(draft, compose);
    expect(compose.mock.calls[0]?.[0]).toMatchObject({ persistSourceLayers: false });
    expect(next.resources.find((item) => item.resourceId === next.compositeResourceId)?.filePath).toContain('composite-2');
    expect(first.layers[1]).toMatchObject({ visible: true, opacity: 1 });
  });
});
