import type {
  CanvasImageCapabilityModelPolicy,
  CanvasImageCapabilityPromptPolicy,
} from './types';

export const PANORAMA_TEXT_TEMPLATE_VERSION = 'panorama-equirectangular-text-v1';
export const PANORAMA_REFERENCE_TEMPLATE_VERSION = 'panorama-equirectangular-reference-v1';

export const PANORAMA_MODEL_POLICY = {
  mode: 'verified-families',
  allowedCanonicalFamilies: ['gpt-image-2'],
  requiredTags: ['text-to-image', 'image-to-image', 'supports-image-editing'],
  providerCompatibility: 'verified-combinations-only',
  allowedProviderConfigurations: [
    { providerId: 'apimart', allowedChannels: ['ext', 'official'] },
    { providerId: 'kie' },
    { providerId: 'grsai', allowedChannels: ['vip'] },
    { providerId: 'fal' },
  ],
  semanticRequirements: {
    aspectRatio: '2:1',
    resolution: '2K',
    referenceImages: { min: 0, max: 1 },
    outputCount: 1,
    quality: 'medium',
  },
} as const satisfies CanvasImageCapabilityModelPolicy;

export const PANORAMA_PROMPT_POLICY = {
  hiddenTemplateVersion: PANORAMA_TEXT_TEMPLATE_VERSION,
  hiddenTemplateVersions: {
    text: PANORAMA_TEXT_TEMPLATE_VERSION,
    reference: PANORAMA_REFERENCE_TEMPLATE_VERSION,
  },
  fixedSemanticParams: {
    projection: 'equirectangular',
    aspectRatio: '2:1',
    resolution: '2K',
    outputCount: 1,
    quality: 'medium',
    maxReferenceImages: 1,
    horizontalCoverageDegrees: 360,
    verticalCoverageDegrees: 180,
  },
  visibleParameterKeys: ['prompt'],
} as const satisfies CanvasImageCapabilityPromptPolicy;
