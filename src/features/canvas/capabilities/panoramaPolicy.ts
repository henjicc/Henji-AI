import { matchesModelFamily } from './modelCompatibility';
import type {
  CanvasImageCapabilityModelPolicy,
  CanvasImageCapabilityPromptPolicy,
  CanvasModelFamilyRule,
} from './types';

export const PANORAMA_TEXT_TEMPLATE_VERSION = 'panorama-equirectangular-text-v1';
export const PANORAMA_REFERENCE_TEMPLATE_VERSION = 'panorama-equirectangular-reference-v1';
export const PANORAMA_DEFAULT_PROMPT_VERSION = 'panorama-user-default-v1';
export const PANORAMA_DEFAULT_PROMPT = '生成一张完整、自然、可沉浸浏览的 360°×180° 等距柱状全景图，左右边缘无缝衔接。';

/** Nano Banana 2 及以后各版（含 lite）与 Pro：暂以最接近 2:1 的 21:9 开放实验。 */
const PANORAMA_EXPERIMENTAL_WIDE_FAMILY: CanvasModelFamilyRule = { series: 'nano-banana', minVersion: 2, variants: ['pro'] };

export function isExperimentalWidePanoramaFamily(canonicalModelId: string): boolean {
  return matchesModelFamily(canonicalModelId, [PANORAMA_EXPERIMENTAL_WIDE_FAMILY]);
}

export const PANORAMA_MODEL_POLICY = {
  mode: 'verified-families',
  allowedFamilies: [{ series: 'gpt-image', minVersion: 2 }, PANORAMA_EXPERIMENTAL_WIDE_FAMILY],
  requiredTags: ['text-to-image', 'image-to-image'],
  providerCompatibility: 'verified-combinations-only',
  allowedProviderConfigurations: [
    { providerId: 'apimart' },
    { providerId: 'kie' },
    { providerId: 'grsai' },
    {
      providerId: 'fal',
      // provider / 1MP 当前会落到约 1456×736，不是严格 2:1；只保留已核验的 2K。
      allowedSemanticValues: { resolution: ['2K'] },
    },
  ],
  semanticRequirements: {
    // GPT Image 系列必须严格 2:1（结果校验也按 2:1）；21:9 只是 Nano Banana 系列的实验退路。
    aspectRatio: ['2:1', { value: '21:9', families: [PANORAMA_EXPERIMENTAL_WIDE_FAMILY] }],
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
