import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { composeModelDefinition } from '@/core/composeModelDefinition';
import { registry } from '@/core/ModelRegistry';
import { apimartPresentation } from '@/models/presentation/apimart';
import { falPresentation } from '@/models/presentation/fal';
import { apimartGptImage2Model } from '../../../../packages/ai-sdk/src/catalog/apimart/gpt-image-2.model';
import { falGptImage2Model } from '../../../../packages/ai-sdk/src/catalog/fal/gpt-image-2.model';
import { CANVAS_IMAGE_CAPABILITY_IDS } from '../capabilities';
import { validateGenerationOutputBatchContract } from '../application/generationOutputApplicationService';
import { CANVAS_NODE_TYPES } from './canvasNodes';
import { createDefaultGenerationOutputItems } from './generationOutputs';
import { migratePortraitTextureGenerationData } from './nodeMigrations';
import { canvasNodeDefinitions } from './nodeRegistry';

const registeredModelIds = new Set<string>();

beforeAll(() => {
  if (!registry.getModel(falGptImage2Model.meta.id)) {
    registry.register(composeModelDefinition(
      falGptImage2Model,
      falPresentation[falGptImage2Model.meta.id],
    ));
    registeredModelIds.add(falGptImage2Model.meta.id);
  }
  if (!registry.getModel(apimartGptImage2Model.meta.id)) {
    registry.register(composeModelDefinition(
      apimartGptImage2Model,
      apimartPresentation[apimartGptImage2Model.meta.id],
    ));
    registeredModelIds.add(apimartGptImage2Model.meta.id);
  }
});

afterAll(() => {
  for (const modelId of registeredModelIds) registry.unregister(modelId);
});

describe('人像质感节点定义', () => {
  it('复用标准生成执行、单图逐行端口与普通图片结果', () => {
    expect(canvasNodeDefinitions[CANVAS_NODE_TYPES.portraitTextureGen]).toMatchObject({
      type: 'portraitTextureGenNode',
      visibleInMenu: false,
      executionKind: 'standard-generation',
      capabilities: { toolbarGenerate: true, promptInput: false },
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

  it('默认数据锁定版本化保守预设与显式 Fal 路线', () => {
    expect(canvasNodeDefinitions[CANVAS_NODE_TYPES.portraitTextureGen].createDefaultData())
      .toMatchObject({
        displayName: '人像质感',
        capabilityId: CANVAS_IMAGE_CAPABILITY_IDS.portraitTexture,
        modelId: 'fal-ai-gpt-image-2',
        promptTemplateVersion: 'portrait-texture-gpt-image-2-v1',
        mediaInputs: {},
        portraitTextureSettings: {
          portraitTextureContractVersion: 1,
          preset: 'natural-detail',
          strength: 'subtle',
          userPrompt: '',
        },
        params: {
          falGptImage2Resolution: 'medium',
          falGptImage2NumImages: 1,
        },
      });
  });
});

describe('人像质感保存迁移', () => {
  it('保存重开后保留显式供应商、设置与多源图错误，不静默换模型', () => {
    const data: DynamicValueMap = {
      capabilityId: 'broken',
      modelId: 'apimart-gpt-image-2',
      params: {
        apimartGptImage2Version: 'ext',
        apimartGptImage2MaskUrl: ['mask.png'],
      },
      mediaInputs: { image: ['first.png', 'second.png'] },
      portraitTextureSettings: {
        portraitTextureContractVersion: 1,
        preset: 'film-soft',
        strength: 'balanced',
        userPrompt: '保留雀斑',
      },
    };

    migratePortraitTextureGenerationData(data);

    expect(data).toMatchObject({
      capabilityId: 'image.portrait-texture',
      modelId: 'apimart-gpt-image-2',
      promptTemplateVersion: 'portrait-texture-gpt-image-2-v1',
      mediaInputs: { image: ['first.png', 'second.png'] },
      portraitTextureSettings: {
        portraitTextureContractVersion: 1,
        preset: 'film-soft',
        strength: 'balanced',
        userPrompt: '保留雀斑',
      },
      params: {
        apimartGptImage2Version: 'official',
        apimartGptImage2Quality: 'medium',
        apimartGptImage2Count: 1,
      },
      portraitTextureRouteReasons: ['人像质感调节必须且只能提供 1 张源图'],
    });
    expect(String(data.prompt)).toContain('subtle filmic softness');
    expect((data.params as DynamicValueMap).apimartGptImage2MaskUrl).toBeUndefined();
  });

  it('未知设置版本保持原数据并阻止静默迁移', () => {
    const data: DynamicValueMap = {
      portraitTextureSettings: { portraitTextureContractVersion: 2 },
      prompt: 'legacy',
    };
    migratePortraitTextureGenerationData(data);
    expect(data.portraitTextureSettings).toEqual({ portraitTextureContractVersion: 2 });
    expect(data.portraitTextureRouteReasons).toEqual([
      expect.stringContaining('不支持的人像质感契约版本'),
    ]);
  });
});

describe('人像质感普通图片输出', () => {
  it('单张普通图片通过契约，零输出显式失败', () => {
    const outputs = createDefaultGenerationOutputItems({
      sources: ['result.png'],
      mediaType: 'image',
      resultKind: 'image',
      semanticKind: 'generated-media',
    });
    expect(() => validateGenerationOutputBatchContract({
      version: 1,
      strategy: 'single',
      resultKind: 'image',
      expectedOutputCount: 1,
      outputs,
    })).not.toThrow();
    expect(() => validateGenerationOutputBatchContract({
      version: 1,
      strategy: 'single',
      resultKind: 'image',
      expectedOutputCount: 1,
      outputs: [],
    })).toThrow(/生成结果为空/);
  });
});
