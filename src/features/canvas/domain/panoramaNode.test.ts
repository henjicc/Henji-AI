import { describe, expect, it } from 'vitest';

import { CANVAS_IMAGE_CAPABILITY_IDS } from '../capabilities';
import { CANVAS_NODE_TYPES } from './canvasNodes';
import { canvasNodeDefinitions } from './nodeRegistry';
import {
  PANORAMA_DEFAULT_PROMPT,
  PANORAMA_DEFAULT_PROMPT_VERSION,
  PANORAMA_TEXT_TEMPLATE_VERSION,
} from '../capabilities/panoramaPolicy';

describe('720°全景节点定义', () => {
  it('使用标准生成执行、逐行图片端口和专属全景查看结果节点', () => {
    const definition = canvasNodeDefinitions[CANVAS_NODE_TYPES.panoramaGen];
    expect(definition).toMatchObject({
      type: 'panoramaGenNode',
      visibleInMenu: false,
      executionKind: 'standard-generation',
      capabilities: { toolbarGenerate: true },
      connectivity: { targetHandleMode: 'rows' },
      ports: {
        source: { emits: 'image' },
        target: { accepts: ['image'] },
      },
      generation: {
        modelType: 'image',
        resultNodeType: CANVAS_NODE_TYPES.panoramaViewer,
      },
    });

    expect(canvasNodeDefinitions[CANVAS_NODE_TYPES.imageEdit].generation).toEqual({
      modelType: 'image',
      resultNodeType: CANVAS_NODE_TYPES.exportImage,
    });
  });

  it('默认数据保存能力编号、模板版本和固定语义', () => {
    const data = canvasNodeDefinitions[CANVAS_NODE_TYPES.panoramaGen].createDefaultData();
    expect(data).toMatchObject({
      displayName: '720°全景',
      capabilityId: CANVAS_IMAGE_CAPABILITY_IDS.panorama,
      promptTemplateVersion: PANORAMA_TEXT_TEMPLATE_VERSION,
      defaultPromptVersion: PANORAMA_DEFAULT_PROMPT_VERSION,
      prompt: PANORAMA_DEFAULT_PROMPT,
      promptDocument: expect.objectContaining({
        content: [expect.objectContaining({
          content: [expect.objectContaining({ text: PANORAMA_DEFAULT_PROMPT })],
        })],
      }),
      aspectRatio: '2:1',
      mediaInputs: {},
      fixedSemanticParams: {
        projection: 'equirectangular',
        aspectRatio: '2:1',
        outputCount: 1,
        maxReferenceImages: 1,
      },
    });
  });

  it('全景查看节点是隐藏的图片结果节点，并关闭顶部图片派生能力', () => {
    const definition = canvasNodeDefinitions[CANVAS_NODE_TYPES.panoramaViewer];

    expect(definition).toMatchObject({
      type: CANVAS_NODE_TYPES.panoramaViewer,
      visibleInMenu: false,
      capabilities: {
        toolbar: true,
        toolbarDownload: true,
        toolbarImageCapabilities: false,
      },
      connectivity: {
        sourceHandle: true,
        targetHandle: true,
        manualSource: true,
      },
      media: { kind: 'image', role: 'result' },
      ports: { source: { emits: 'image' } },
    });
    expect(definition.getOutputs?.({
      ...definition.createDefaultData(),
      imageUrl: '/managed/panorama.png',
      previewImageUrl: '/managed/panorama-preview.webp',
    })).toEqual([{
      kind: 'image',
      url: '/managed/panorama.png',
      previewUrl: '/managed/panorama-preview.webp',
    }]);
    expect(definition.createDefaultData()).toMatchObject({
      displayName: '全景查看',
      imageUrl: null,
      previewImageUrl: null,
      aspectRatio: '2:1',
      resultKind: 'panorama',
      viewMode: 'sphere',
      viewportAspectRatio: '16:9',
      cameraView: { yaw: 0, pitch: 0, fov: 70 },
    });
  });
});
