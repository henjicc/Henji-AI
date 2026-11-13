import type { ModelDefinition } from '@/core/types';

import type { CanvasImageCapabilityModelPolicy } from './types';

export const LAYER_STACK_CONTRACT_VERSION = 1 as const;
export const LAYER_SEPARATION_DEFAULT_MODEL_ID = 'volcengine-seedream-5.0-pro';
const LAYER_SEPARATION_PROVIDER_PRIORITY = ['volcengine', 'apimart', 'kie', 'fal'] as const;
/**
 * 前者优先作默认。5.0 Pro 已做过真实拆图层验证；5.5 的请求与结果解析按官方契约与示例离线核对，
 * 尚未真实调用，所以只供用户在节点里显式切换，不作默认。
 */
const LAYER_SEPARATION_FAMILIES = ['seedream-5.0-pro', 'seedream-5.5'] as const;
const LAYER_SEPARATION_DEFAULT_FAMILY = 'seedream-5.0-pro';

export const LAYER_SEPARATION_MODEL_POLICY = {
  mode: 'verified-families',
  allowedFamilies: [...LAYER_SEPARATION_FAMILIES],
  requiredTags: ['layer-decomposition'],
  providerCompatibility: 'verified-combinations-only',
  allowedProviderConfigurations: LAYER_SEPARATION_PROVIDER_PRIORITY.map((providerId) => ({ providerId })),
  semanticRequirements: {
    referenceImages: { min: 1, max: 1 },
    parameterValues: { 'layer-decomposition-mode': 'layer-decomposition' },
  },
} as const satisfies CanvasImageCapabilityModelPolicy;

/** 原厂优先；聚合渠道只作用户显式切换，不在失败后自动重试以免重复计费。 */
export function selectDefaultLayerSeparationModel(
  models: readonly ModelDefinition[],
): ModelDefinition | null {
  return [...models]
    .filter((model) => model.meta.canonicalModelId === LAYER_SEPARATION_DEFAULT_FAMILY
      && model.meta.tags?.includes('layer-decomposition')
      && LAYER_SEPARATION_PROVIDER_PRIORITY.includes(
        model.meta.provider as (typeof LAYER_SEPARATION_PROVIDER_PRIORITY)[number],
      ))
    .sort((left, right) => LAYER_SEPARATION_PROVIDER_PRIORITY.indexOf(
      left.meta.provider as (typeof LAYER_SEPARATION_PROVIDER_PRIORITY)[number],
    ) - LAYER_SEPARATION_PROVIDER_PRIORITY.indexOf(
      right.meta.provider as (typeof LAYER_SEPARATION_PROVIDER_PRIORITY)[number],
    ))[0] ?? null;
}
