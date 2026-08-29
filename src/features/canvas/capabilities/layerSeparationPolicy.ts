import type { ModelDefinition } from '@/core/types';

import type { CanvasImageCapabilityModelPolicy } from './types';

export const LAYER_STACK_CONTRACT_VERSION = 1 as const;
export const LAYER_SEPARATION_DEFAULT_MODEL_ID = 'volcengine-seedream-5.0-pro';
export const LAYER_SEPARATION_PROVIDER_PRIORITY = ['volcengine', 'apimart', 'kie'] as const;

export const LAYER_SEPARATION_MODEL_POLICY = {
  mode: 'verified-families',
  allowedCanonicalFamilies: ['seedream-5.0-pro'],
  requiredTags: ['supports-layer-decomposition'],
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
    .filter((model) => model.meta.canonicalModelId === 'seedream-5.0-pro'
      && model.meta.tags?.includes('supports-layer-decomposition')
      && LAYER_SEPARATION_PROVIDER_PRIORITY.includes(
        model.meta.provider as (typeof LAYER_SEPARATION_PROVIDER_PRIORITY)[number],
      ))
    .sort((left, right) => LAYER_SEPARATION_PROVIDER_PRIORITY.indexOf(
      left.meta.provider as (typeof LAYER_SEPARATION_PROVIDER_PRIORITY)[number],
    ) - LAYER_SEPARATION_PROVIDER_PRIORITY.indexOf(
      right.meta.provider as (typeof LAYER_SEPARATION_PROVIDER_PRIORITY)[number],
    ))[0] ?? null;
}
