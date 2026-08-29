import { describe, expect, it, vi } from 'vitest';

import { createStableLayerId, createStableLayerResourceId, createStableLayerStackId, type LayerStackDocumentV1 } from '../domain/layerStack';
import {
  commitLayerSeparationGeneration,
  createLayerStackGenerationContract,
} from './layerSeparationGenerationService';
import type { PrepareLayerStackDocumentInput } from './layerStackApplicationService';

const structuredOutput = {
  version: 1 as const,
  kind: 'layer-stack' as const,
  primary: { version: 1 as const, sourceOutputIndex: 0, url: 'https://fixtures.invalid/base.jpg', filePath: '/media/base.jpg', zIndex: 0, role: 'base' as const, width: 8, height: 8, format: 'jpeg' as const },
  outputs: [
    { version: 1 as const, sourceOutputIndex: 0, url: 'https://fixtures.invalid/base.jpg', filePath: '/media/base.jpg', zIndex: 0, role: 'base' as const, width: 8, height: 8, format: 'jpeg' as const },
    { version: 1 as const, sourceOutputIndex: 1, url: 'https://fixtures.invalid/title.png', filePath: '/media/title.png', zIndex: 1, role: 'content' as const, name: '标题', width: 3, height: 2, format: 'png' as const, boundingBox: { absolute: [2, 3, 5, 5] as [number, number, number, number] } },
  ],
  metadata: { colorSpace: 'srgb' as const, alphaMode: 'straight' as const, compositeOperation: 'source-over' as const, order: 'bottom-to-top' as const },
};

function preparedDocument(): LayerStackDocumentV1 {
  const completionId = 'generation-output:placeholder';
  const stackId = createStableLayerStackId(completionId);
  return {
    version: 1,
    stackId,
    status: 'ready',
    source: { capabilityId: 'image.layer-separation', sourceNodeId: 'source', inputResourceId: '/media/input.png', providerId: 'volcengine', modelId: 'volcengine-seedream-5.0-pro', completionId },
    canvas: { width: 8, height: 8, colorSpace: 'srgb', alphaMode: 'straight', compositeOperation: 'source-over', clipPolicy: 'canvas-bounds' },
    compositeResourceId: `${stackId}:composite`,
    thumbnailResourceId: `${stackId}:thumbnail`,
    layers: [
      { version: 1, layerId: createStableLayerId(stackId, 0), sourceOutputIndex: 0, providerZIndex: 0, order: 0, role: 'base', name: '底图', resourceId: createStableLayerResourceId(stackId, 0), placement: { x: 0, y: 0, width: 8, height: 8 }, opacity: 1, visible: true, blendMode: 'normal', alpha: 'opaque' },
      { version: 1, layerId: createStableLayerId(stackId, 1), sourceOutputIndex: 1, providerZIndex: 1, order: 1, role: 'content', name: '标题', resourceId: createStableLayerResourceId(stackId, 1), placement: { x: 2, y: 3, width: 3, height: 2 }, opacity: 1, visible: true, blendMode: 'normal', alpha: 'straight' },
    ],
    resources: [
      { version: 1, resourceId: createStableLayerResourceId(stackId, 0), status: 'ready', filePath: '/managed/base.jpg', mimeType: 'image/jpeg', width: 8, height: 8, hasAlpha: false, byteLength: 100, sha256: 'base' },
      { version: 1, resourceId: createStableLayerResourceId(stackId, 1), status: 'ready', filePath: '/managed/title.png', mimeType: 'image/png', width: 3, height: 2, hasAlpha: true, byteLength: 50, sha256: 'title' },
      { version: 1, resourceId: `${stackId}:composite`, status: 'ready', filePath: '/managed/composite.png', mimeType: 'image/png', width: 8, height: 8, hasAlpha: true, byteLength: 120, sha256: 'composite' },
      { version: 1, resourceId: `${stackId}:thumbnail`, status: 'ready', filePath: '/managed/thumb.webp', mimeType: 'image/webp', width: 8, height: 8, hasAlpha: false, byteLength: 40, sha256: 'thumbnail' },
    ],
  };
}

describe('layerSeparationGenerationService', () => {
  it('按 bottom-to-top 顺序生成图层描述符且不伪造动态输出数量', () => {
    const contract = createLayerStackGenerationContract(structuredOutput);
    expect(contract).toMatchObject({ strategy: 'layer-stack', resultKind: 'layer-stack' });
    expect(contract.expectedOutputCount).toBeUndefined();
    expect(contract.outputs.map((item) => [item.descriptor.order, item.descriptor.layer?.index, item.descriptor.semantic.label])).toEqual([
      [0, 0, '底图'],
      [1, 1, '标题'],
    ]);
  });

  it('先完成全量预验证，再把文档交给 4.1 一次原子提交', async () => {
    const prepareDocument = vi.fn(async () => preparedDocument());
    const commitOutputs = vi.fn(async (input) => ({
      projectId: 'project',
      completionId: input.completionId ?? '',
      strategy: input.contract.strategy,
      resultNodeIds: ['placeholder'],
      groupNodeId: null,
      idempotent: false,
    }));
    const result = await commitLayerSeparationGeneration({
      sourceNodeId: 'source',
      placeholderNodeId: 'placeholder',
      resultNodeType: 'exportImageNode',
      completionId: 'generation-output:placeholder',
      sourceImage: '/media/input.png',
      providerId: 'volcengine',
      modelId: 'volcengine-seedream-5.0-pro',
      result: { outputs: ['/media/base.jpg', '/media/title.png'], primary: '/media/base.jpg', structuredOutput },
      prepareDocument,
      commitOutputs,
    });
    expect(prepareDocument).toHaveBeenCalledOnce();
    expect(commitOutputs).toHaveBeenCalledWith(expect.objectContaining({ preparedLayerStack: expect.objectContaining({ status: 'ready' }) }));
    expect(result.resultNodeIds).toEqual(['placeholder']);
  });

  it('结构化协议缺失或媒体数量错位时不进入主进程合成', async () => {
    const prepareDocument = vi.fn();
    const base = { sourceNodeId: 'source', placeholderNodeId: 'placeholder', resultNodeType: 'exportImageNode' as const, completionId: 'generation-output:placeholder', sourceImage: '/media/input.png', providerId: 'volcengine', modelId: 'model', prepareDocument };
    await expect(commitLayerSeparationGeneration({ ...base, result: { outputs: ['/media/base.jpg'], primary: '/media/base.jpg' } })).rejects.toThrow(/缺少结构化/);
    await expect(commitLayerSeparationGeneration({ ...base, result: { outputs: ['/media/base.jpg'], primary: '/media/base.jpg', structuredOutput } })).rejects.toThrow(/数量不一致/);
    expect(prepareDocument).not.toHaveBeenCalled();
  });

  it('画布原子事务失败时只释放本次合成新建的受管文件', async () => {
    const releaseResources = vi.fn(async () => undefined);
    const prepareDocument = vi.fn(async (input: PrepareLayerStackDocumentInput) => {
      input.onCreatedFilePaths?.(['/managed/new-composite.png', '/managed/new-thumb.webp']);
      return preparedDocument();
    });
    await expect(commitLayerSeparationGeneration({
      sourceNodeId: 'source',
      placeholderNodeId: 'placeholder',
      resultNodeType: 'exportImageNode',
      completionId: 'generation-output:placeholder',
      sourceImage: '/media/input.png',
      providerId: 'volcengine',
      modelId: 'volcengine-seedream-5.0-pro',
      result: { outputs: ['/media/base.jpg', '/media/title.png'], primary: '/media/base.jpg', structuredOutput },
      prepareDocument,
      commitOutputs: vi.fn(async () => { throw new Error('画布事务失败'); }),
      releaseResources,
    })).rejects.toThrow(/画布事务失败/);
    expect(releaseResources).toHaveBeenCalledWith(['/managed/new-composite.png', '/managed/new-thumb.webp']);
  });
});
