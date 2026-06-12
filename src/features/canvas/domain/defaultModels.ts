import { registry } from '@/core/ModelRegistry';

export type CanvasModelMediaType = 'image' | 'video' | 'audio';

/** 各媒体类型的默认模型偏好顺序（命中即用，未命中回退第一个已注册模型） */
const PREFERRED_DEFAULT_MODEL_IDS: Record<CanvasModelMediaType, string[]> = {
  image: [
    'fal-ai-nano-banana',
    'fal-ai-nano-banana-pro',
    'kie-nano-banana-pro',
    'ppio-seedream-4.5',
    'ppio-seedream-4.0',
  ],
  video: [],
  audio: [],
};

export function getDefaultModelId(mediaType: CanvasModelMediaType): string {
  const models = registry.getModelsByType(mediaType);
  for (const preferredId of PREFERRED_DEFAULT_MODEL_IDS[mediaType]) {
    if (models.some((model) => model.meta.id === preferredId)) {
      return preferredId;
    }
  }
  return models[0]?.meta.id ?? '';
}

/** Provider 显示名映射（与设置页一致的简洁标签） */
export const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  ppio: 'PPIO',
  fal: 'Fal',
  kie: 'KIE',
  modelscope: 'ModelScope',
};

export function getProviderDisplayName(providerId: string): string {
  return PROVIDER_DISPLAY_NAMES[providerId.toLowerCase()] ?? (providerId ? providerId.toUpperCase() : 'Unknown');
}
