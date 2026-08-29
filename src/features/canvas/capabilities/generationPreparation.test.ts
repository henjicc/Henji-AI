import { describe, expect, it } from 'vitest';
import type { ModelRuntimeDefinition } from '@henjicc/ai-sdk';

import { composeModelDefinition } from '@/core/composeModelDefinition';
import { modelPresentations } from '@/models/presentation';
import { apimartGptImage2Model } from '../../../../packages/ai-sdk/src/catalog/apimart/gpt-image-2.model';
import { kieNanoBanana2Model } from '../../../../packages/ai-sdk/src/catalog/kie/nano-banana-2.model';
import { CANVAS_IMAGE_CAPABILITY_IDS } from './types';
import { builtInCanvasImageCapabilities } from './builtInCapabilities';
import {
  prepareCanvasCapabilityGeneration,
  validateCanvasCapabilityResultPatch,
} from './generationPreparation';
import {
  PANORAMA_REFERENCE_TEMPLATE_VERSION,
  PANORAMA_TEXT_TEMPLATE_VERSION,
} from './panoramaPolicy';

const panorama = builtInCanvasImageCapabilities.find(
  (capability) => capability.id === CANVAS_IMAGE_CAPABILITY_IDS.panorama,
);
if (!panorama) throw new Error('缺少全景能力定义');

const model = composeModelDefinition(
  apimartGptImage2Model as ModelRuntimeDefinition,
  modelPresentations[apimartGptImage2Model.meta.id],
);
const nanoModel = composeModelDefinition(
  kieNanoBanana2Model as ModelRuntimeDefinition,
  modelPresentations[kieNanoBanana2Model.meta.id],
);

describe('全景能力生成准备', () => {
  it('文生图保留用户原文并使用版本化完整球面模板', () => {
    const prepared = prepareCanvasCapabilityGeneration({
      capability: panorama,
      model,
      currentParams: {
        apimartGptImage2AspectRatio: '1:1',
        apimartGptImage2Resolution: '1K',
        apimartGptImage2Count: 4,
        output_format: 'png',
      },
      userPrompt: '日落时分的现代木质客厅',
      referenceImageCount: 0,
    });

    expect(prepared.compatible).toBe(true);
    expect(prepared.userPrompt).toBe('日落时分的现代木质客厅');
    expect(prepared.templateVersion).toBe(PANORAMA_TEXT_TEMPLATE_VERSION);
    expect(prepared.prompt).toContain('[用户场景描述]\n日落时分的现代木质客厅');
    expect(prepared.prompt).toContain('水平 360° 和垂直 180°');
    expect(prepared.prompt).toContain('严格 2:1');
    expect(prepared.params).toMatchObject({
      apimartGptImage2AspectRatio: '2:1',
      apimartGptImage2Resolution: '1K',
      apimartGptImage2Count: 1,
    });
    expect(prepared.params).not.toHaveProperty('output_format');
    expect(prepared.resultNodeData).toMatchObject({
      resultKind: 'panorama',
      sourceCapabilityId: 'image.panorama',
      sourceCapabilityTemplateVersion: PANORAMA_TEXT_TEMPLATE_VERSION,
      generationUserPrompt: '日落时分的现代木质客厅',
      generationCanonicalModelId: 'gpt-image-2',
      generationModelId: 'apimart-gpt-image-2',
      panoramaProjectionMode: 'strict-2:1',
    });
  });

  it('单张参考图自动切换参考模板，超过一张会在请求前拒绝', () => {
    const reference = prepareCanvasCapabilityGeneration({
      capability: panorama,
      model,
      currentParams: {},
      userPrompt: '保留建筑材质并补全未展示方向',
      referenceImageCount: 1,
    });
    expect(reference.compatible).toBe(true);
    expect(reference.templateVersion).toBe(PANORAMA_REFERENCE_TEMPLATE_VERSION);
    expect(reference.prompt).toContain('[参考图角色]');
    expect(reference.prompt).toContain('不是要直接拉伸、镜像或平铺');

    const tooMany = prepareCanvasCapabilityGeneration({
      capability: panorama,
      model,
      currentParams: {},
      userPrompt: '补全场景',
      referenceImageCount: 2,
    });
    expect(tooMany.compatible).toBe(false);
    expect(tooMany.reasons).toContain('当前能力只支持 0～1 张参考图');
  });

  it('只接受精确2:1的持久化结果', () => {
    expect(() => validateCanvasCapabilityResultPatch(panorama, { aspectRatio: '2:1' }))
      .not.toThrow();
    expect(() => validateCanvasCapabilityResultPatch(panorama, { aspectRatio: '16:9' }))
      .toThrow('生成结果不是完整全景所需的 2:1');
  });

  it('Nano Banana 以 21:9 实验宽幅生成并通过对应结果校验', () => {
    const prepared = prepareCanvasCapabilityGeneration({
      capability: panorama,
      model: nanoModel,
      currentParams: {},
      userPrompt: '森林环绕的湖边',
      referenceImageCount: 0,
    });
    expect(prepared.compatible).toBe(true);
    expect(prepared.params.kieNanoBanana2AspectRatio).toBe('21:9');
    expect(prepared.resultNodeData.panoramaProjectionMode).toBe('experimental-wide');
    expect(() => validateCanvasCapabilityResultPatch(
      panorama,
      { aspectRatio: '21:9' },
      prepared.resultNodeData.panoramaProjectionMode,
    )).not.toThrow();
    expect(() => validateCanvasCapabilityResultPatch(panorama, { aspectRatio: '21:9' }))
      .toThrow('生成结果不是完整全景所需的 2:1');
  });
});
