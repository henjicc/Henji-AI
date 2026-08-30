import { describe, expect, it } from 'vitest';

import { CANVAS_IMAGE_CAPABILITY_IDS } from '../capabilities';
import { CANVAS_NODE_TYPES } from './canvasNodes';
import { canvasNodeDefinitions } from './nodeRegistry';

describe('高清放大节点定义', () => {
  it('复用标准生成执行、单图逐行端口与普通图片结果', () => {
    expect(canvasNodeDefinitions[CANVAS_NODE_TYPES.upscaleGen]).toMatchObject({
      type: 'upscaleGenNode',
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

  it('默认数据锁定 Topaz 精确放大与第二版预检契约', () => {
    expect(canvasNodeDefinitions[CANVAS_NODE_TYPES.upscaleGen].createDefaultData()).toMatchObject({
      displayName: '高清放大',
      capabilityId: CANVAS_IMAGE_CAPABILITY_IDS.upscale,
      prompt: '',
      promptTemplateVersion: null,
      modelId: 'fal-ai-topaz-image-upscale',
      mediaInputs: {},
      params: {
        falTopazUpscaleMode: 'precision',
        falTopazPrecisionModel: 'High Fidelity V3',
        falTopazUpscaleFactor: 2,
        falTopazFaceEnhancement: false,
      },
      fixedSemanticParams: {
        upscaleContractVersion: 2,
      },
    });
  });
});
