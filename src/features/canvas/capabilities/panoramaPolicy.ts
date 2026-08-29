import type {
  CanvasImageCapabilityModelPolicy,
  CanvasImageCapabilityPromptPolicy,
} from './types';

export const PANORAMA_TEXT_TEMPLATE_VERSION = 'panorama-equirectangular-text-v1';
export const PANORAMA_REFERENCE_TEMPLATE_VERSION = 'panorama-equirectangular-reference-v1';
export const PANORAMA_DEFAULT_PROMPT_VERSION = 'panorama-user-default-v1';
export const PANORAMA_DEFAULT_PROMPT = '生成一张完整、自然、可沉浸浏览的 360°×180° 等距柱状全景图，左右边缘无缝衔接。';

export const PANORAMA_EXPERIMENTAL_WIDE_FAMILIES = [
  'nano-banana-2-lite',
  'nano-banana-2',
  'nano-banana-pro',
] as const;

export function isExperimentalWidePanoramaFamily(canonicalModelId: string): boolean {
  return (PANORAMA_EXPERIMENTAL_WIDE_FAMILIES as readonly string[]).includes(canonicalModelId);
}

export const PANORAMA_MODEL_POLICY = {
  mode: 'verified-families',
  allowedCanonicalFamilies: ['gpt-image-2', ...PANORAMA_EXPERIMENTAL_WIDE_FAMILIES],
  requiredTags: ['text-to-image', 'image-to-image', 'supports-image-editing'],
  providerCompatibility: 'verified-combinations-only',
  allowedProviderConfigurations: [
    { providerId: 'apimart', allowedChannels: ['ext', 'official'] },
    { providerId: 'kie' },
    { providerId: 'grsai', allowedChannels: ['vip'] },
    {
      providerId: 'fal',
      // provider / 1MP 当前会落到约 1456×736，不是严格 2:1；只保留已核验的 2K。
      allowedSemanticValues: { resolution: ['2K'] },
    },
  ],
  semanticRequirements: {
    // GPT Image 2 使用严格 2:1；Nano Banana 系列暂以最接近的 21:9 开放实验。
    aspectRatio: ['2:1', '21:9'],
    referenceImages: { min: 0, max: 1 },
    outputCount: 1,
  },
  semanticDefaults: {
    resolution: '2K',
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
    outputCount: 1,
    maxReferenceImages: 1,
    horizontalCoverageDegrees: 360,
    verticalCoverageDegrees: 180,
  },
  visibleParameterKeys: ['prompt'],
  visibleParameterSemantics: ['channel', 'resolution', 'quality'],
} as const satisfies CanvasImageCapabilityPromptPolicy;
