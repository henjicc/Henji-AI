import { describe, expect, it } from 'vitest';
import { composeModelDefinition } from '@/core/composeModelDefinition';
import { modelPresentations } from '@/models/presentation';
import type { ModelRuntimeDefinition } from '@henjicc/ai-sdk';
import { apimartGptImage2Model as apimartRuntime } from '../../../../packages/ai-sdk/src/catalog/apimart/gpt-image-2.model';
import { kieGptImage2Model as kieRuntime } from '../../../../packages/ai-sdk/src/catalog/kie/gpt-image-2.model';
import { grsaiGptImage2Model as grsaiRuntime } from '../../../../packages/ai-sdk/src/catalog/grsai/gpt-image-2.model';
import { falGptImage2Model as falRuntime } from '../../../../packages/ai-sdk/src/catalog/fal/gpt-image-2.model';
import { kieNanoBanana2LiteModel } from '../../../../packages/ai-sdk/src/catalog/kie/nano-banana-2-lite.model';
import { kieNanoBanana2Model } from '../../../../packages/ai-sdk/src/catalog/kie/nano-banana-2.model';
import { kieNanoBananaProModel } from '../../../../packages/ai-sdk/src/catalog/kie/nano-banana-pro.model';
import type { ModelDefinition } from '@/core/types';
import { CANVAS_IMAGE_CAPABILITY_IDS } from './types';
import { builtInCanvasImageCapabilities } from './builtInCapabilities';
import {
  mapCanvasCapabilityModelParams,
  resolveCanvasCapabilityModelCandidates,
  resolveCanvasCapabilityVisibleParamIds,
} from './modelCompatibility';

function compose(runtime: ModelRuntimeDefinition): ModelDefinition {
  return composeModelDefinition(runtime, modelPresentations[runtime.meta.id]);
}

const panorama = builtInCanvasImageCapabilities.find(
  (capability) => capability.id === CANVAS_IMAGE_CAPABILITY_IDS.panorama,
);
const nineGrid = builtInCanvasImageCapabilities.find(
  (capability) => capability.id === CANVAS_IMAGE_CAPABILITY_IDS.nineGrid,
);

if (!panorama || !nineGrid) throw new Error('缺少全景或九宫格能力定义');

const models = [
  compose(apimartRuntime),
  compose(kieRuntime),
  compose(grsaiRuntime),
  compose(falRuntime),
];
const nanoModels = [
  compose(kieNanoBanana2LiteModel),
  compose(kieNanoBanana2Model),
  compose(kieNanoBananaProModel),
];

describe('画布能力模型约束与语义参数映射', () => {
  it('九宫格复用节点 schema 选择器，仅接受图片编辑标签且不伪造平台白名单', () => {
    const withoutImageEditing: ModelDefinition = {
      ...models[0],
      meta: {
        ...models[0].meta,
        id: 'text-only-image',
        tags: models[0].meta.tags?.filter((tag) => tag !== 'image-to-image'),
      },
    };
    const result = resolveCanvasCapabilityModelCandidates(
      [models[0], withoutImageEditing],
      nineGrid.modelPolicy,
    );
    expect(result.candidates.map(({ model }) => model.meta.id)).toEqual(['apimart-gpt-image-2']);
    expect(result.rejected[0].reasons).toEqual([
      expect.objectContaining({ code: 'required-tag' }),
    ]);
  });

  it('全景接受 GPT Image 2 与 Nano Banana 实验模型，仍拒绝无关模型', () => {
    const unrelated: ModelDefinition = {
      ...models[0],
      meta: { ...models[0].meta, id: 'other-image', canonicalModelId: 'other-image' },
    };
    const result = resolveCanvasCapabilityModelCandidates(
      [...models, ...nanoModels, unrelated],
      panorama.modelPolicy,
    );

    expect(result.candidates.map(({ model }) => model.meta.id)).toEqual([
      'apimart-gpt-image-2',
      'kie-gpt-image-2',
      'grsai-gpt-image-2',
      'fal-ai-gpt-image-2',
      'kie-nano-banana-2-lite',
      'kie-nano-banana-2',
      'kie-nano-banana-pro',
    ]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reasons.map(({ code }) => code)).toContain('canonical-family');
  });

  it.each([
    ['kie-nano-banana-2-lite', 'kieNanoBanana2LiteAspectRatio'],
    ['kie-nano-banana-2', 'kieNanoBanana2AspectRatio'],
    ['kie-nano-banana-pro', 'kieNanoBananaAspectRatio'],
  ])('%s 用 21:9 进入实验全景链路', (modelId, aspectParamId) => {
    const model = nanoModels.find((candidate) => candidate.meta.id === modelId);
    if (!model) throw new Error(`缺少测试模型 ${modelId}`);
    const result = mapCanvasCapabilityModelParams(model, panorama.modelPolicy);
    expect(result.compatible).toBe(true);
    expect(result.params[aspectParamId]).toBe('21:9');
  });

  it.each([
    ['apimart-gpt-image-2', {
      apimartGptImage2Version: 'ext',
      apimartGptImage2AspectRatio: '2:1',
      apimartGptImage2Resolution: '2K',
      apimartGptImage2Quality: 'medium',
      apimartGptImage2Count: 1,
    }],
    ['kie-gpt-image-2', {
      kieGptImage2AspectRatio: '2:1',
      kieGptImage2Resolution: '2K',
    }],
    ['grsai-gpt-image-2', {
      grsaiGptImage2Channel: 'vip',
      grsaiGptImage2AspectRatio: '2:1',
      grsaiGptImage2Resolution: '2K',
    }],
    ['fal-ai-gpt-image-2', {
      falGptImage2AspectRatio: '2:1',
      falGptImage2ImageSize: '2K',
      falGptImage2Resolution: 'medium',
      falGptImage2NumImages: 1,
    }],
  ] as const)('%s 把 2:1、2K、单张、medium 映射到真实 schema', (modelId, expected) => {
    const model = models.find((candidate) => candidate.meta.id === modelId);
    if (!model) throw new Error(`缺少测试模型 ${modelId}`);
    const result = mapCanvasCapabilityModelParams(model, panorama.modelPolicy);
    expect(result.compatible).toBe(true);
    expect(result.params).toMatchObject(expected);
    expect(Object.values(result.params)).not.toContain('smart');
  });

  it('保留 APIMart 已允许渠道并拒绝未核验供应商', () => {
    const apimart = models[0];
    expect(mapCanvasCapabilityModelParams(apimart, panorama.modelPolicy, {
      apimartGptImage2Version: 'official',
    }).params).toMatchObject({
      apimartGptImage2Version: 'official',
      apimartGptImage2Quality: 'medium',
    });

    const unknownProvider: ModelDefinition = {
      ...apimart,
      meta: { ...apimart.meta, id: 'unknown-provider-gpt-image-2', provider: 'unknown' },
    };
    const rejected = mapCanvasCapabilityModelParams(unknownProvider, panorama.modelPolicy);
    expect(rejected.compatible).toBe(false);
    expect(rejected.reasons.map(({ code }) => code)).toContain('provider-configuration');
  });

  it('保留合法的用户分辨率和质量选择，只固定 2:1 与单张', () => {
    const apimart = models[0];
    const mapped = mapCanvasCapabilityModelParams(apimart, panorama.modelPolicy, {
      apimartGptImage2Version: 'official',
      apimartGptImage2AspectRatio: '16:9',
      apimartGptImage2Resolution: '4K',
      apimartGptImage2Quality: 'high',
      apimartGptImage2Count: 3,
    });
    expect(mapped.params).toMatchObject({
      apimartGptImage2Version: 'official',
      apimartGptImage2AspectRatio: '2:1',
      apimartGptImage2Resolution: '4K',
      apimartGptImage2Quality: 'high',
      apimartGptImage2Count: 1,
    });
  });

  it('只投影渠道、可选择分辨率和真实质量参数，不暴露固定比例与数量', () => {
    const [apimart, kie, grsai, fal] = models;
    expect(resolveCanvasCapabilityVisibleParamIds(
      apimart,
      panorama.modelPolicy,
      panorama.promptPolicy,
    )).toEqual(expect.arrayContaining([
      'apimartGptImage2Version',
      'apimartGptImage2Resolution',
      'apimartGptImage2Quality',
    ]));
    expect(resolveCanvasCapabilityVisibleParamIds(
      kie,
      panorama.modelPolicy,
      panorama.promptPolicy,
    )).toEqual(['prompt', 'kieGptImage2Resolution']);
    expect(resolveCanvasCapabilityVisibleParamIds(
      grsai,
      panorama.modelPolicy,
      panorama.promptPolicy,
    )).toEqual(['prompt', 'grsaiGptImage2Resolution']);
    expect(resolveCanvasCapabilityVisibleParamIds(
      fal,
      panorama.modelPolicy,
      panorama.promptPolicy,
    )).toEqual(['prompt', 'falGptImage2Resolution']);
  });

  it('供应商没有目标默认档时选择最接近的合法分辨率', () => {
    const synthetic: ModelDefinition = {
      ...models[1],
      meta: { ...models[1].meta, id: 'synthetic-kie' },
      params: models[1].params.map((param) => param.id === 'kieGptImage2Resolution'
        ? { ...param, options: [{ value: '1K', label: '1K' }, { value: '4K', label: '4K' }] }
        : param),
    };
    const mapped = mapCanvasCapabilityModelParams(synthetic, panorama.modelPolicy);
    expect(mapped.params.kieGptImage2Resolution).toBe('1K');
  });

  it('映射后的请求不发送 smart 或 output_format，并自动走生成/编辑路由', async () => {
    for (const model of models) {
      const mapped = mapCanvasCapabilityModelParams(model, panorama.modelPolicy);
      const textParams = { ...mapped.params, prompt: 'panorama' };
      const imageParams = { ...textParams, images: ['reference.png'] };
      const textBody = await model.request?.builder?.(textParams);
      const imageBody = await model.request?.builder?.(imageParams);
      expect(JSON.stringify(textBody)).not.toContain('smart');
      expect(textBody).not.toHaveProperty('output_format');
      expect(imageBody).not.toHaveProperty('output_format');
    }

    const kie = models.find((model) => model.meta.id === 'kie-gpt-image-2');
    const fal = models.find((model) => model.meta.id === 'fal-ai-gpt-image-2');
    if (!kie || !fal) throw new Error('缺少自动路由测试模型');
    const kieParams = mapCanvasCapabilityModelParams(kie, panorama.modelPolicy).params;
    expect(kie.request?.builder?.({ ...kieParams, prompt: 'text' })).toMatchObject({
      model: 'gpt-image-2-text-to-image',
    });
    expect(kie.request?.builder?.({ ...kieParams, prompt: 'edit', images: ['reference.png'] }))
      .toMatchObject({ model: 'gpt-image-2-image-to-image' });
    const falSelector = fal.endpoints as { selector: (params: DynamicValueMap) => Promise<string> };
    expect(await falSelector.selector({})).toBe('openai/gpt-image-2');
    expect(await falSelector.selector({ images: ['reference.png'] })).toBe('openai/gpt-image-2/edit');
  });
});
