import { describe, expect, it } from 'vitest';

import { CANVAS_IMAGE_CAPABILITY_IDS } from '../capabilities';
import { CANVAS_NODE_TYPES } from './canvasNodes';
import { canvasNodeDefinitions } from './nodeRegistry';
import {
  PANORAMA_TEXT_TEMPLATE_VERSION,
} from '../capabilities/panoramaPolicy';

describe('720°全景节点定义', () => {
  it('使用标准生成执行、逐行图片端口和图片结果节点', () => {
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
        resultNodeType: CANVAS_NODE_TYPES.exportImage,
      },
    });
  });

  it('默认数据保存能力编号、模板版本和固定语义', () => {
    const data = canvasNodeDefinitions[CANVAS_NODE_TYPES.panoramaGen].createDefaultData();
    expect(data).toMatchObject({
      displayName: '720°全景',
      capabilityId: CANVAS_IMAGE_CAPABILITY_IDS.panorama,
      promptTemplateVersion: PANORAMA_TEXT_TEMPLATE_VERSION,
      aspectRatio: '2:1',
      mediaInputs: {},
      fixedSemanticParams: {
        projection: 'equirectangular',
        aspectRatio: '2:1',
        resolution: '2K',
        outputCount: 1,
        maxReferenceImages: 1,
      },
    });
  });
});
