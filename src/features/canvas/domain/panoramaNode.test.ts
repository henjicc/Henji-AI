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
  it('默认数据保存能力编号、模板版本和与提示词同步的结构化文档', () => {
    const data = canvasNodeDefinitions[CANVAS_NODE_TYPES.panoramaGen].createDefaultData();
    expect(data).toMatchObject({
      capabilityId: CANVAS_IMAGE_CAPABILITY_IDS.panorama,
      promptTemplateVersion: PANORAMA_TEXT_TEMPLATE_VERSION,
      defaultPromptVersion: PANORAMA_DEFAULT_PROMPT_VERSION,
      prompt: PANORAMA_DEFAULT_PROMPT,
      promptDocument: expect.objectContaining({
        content: [expect.objectContaining({
          content: [expect.objectContaining({ text: PANORAMA_DEFAULT_PROMPT })],
        })],
      }),
    });
  });

  it('全景查看节点把托管图片与预览图作为图片输出', () => {
    const definition = canvasNodeDefinitions[CANVAS_NODE_TYPES.panoramaViewer];

    expect(definition.getOutputs?.({
      ...definition.createDefaultData(),
      imageUrl: '/managed/panorama.png',
      previewImageUrl: '/managed/panorama-preview.webp',
    })).toEqual([{
      kind: 'image',
      url: '/managed/panorama.png',
      previewUrl: '/managed/panorama-preview.webp',
    }]);
  });
});
