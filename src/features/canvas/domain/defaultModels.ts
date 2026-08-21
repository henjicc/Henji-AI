import type { ModelTag } from '@/core/types';
import {
  modelDefaultsManager,
  type DefaultModelMediaType,
} from '@/features/settings/modelDefaultsManager';

export type CanvasModelMediaType = DefaultModelMediaType;

/**
 * @param requiredTags 可选，限定候选模型必须同时具备的标签（如仅允许支持图片编辑的模型）
 */
export function getDefaultModelId(mediaType: CanvasModelMediaType, requiredTags: ModelTag[] = []): string {
  return modelDefaultsManager.resolveModelId(mediaType, requiredTags);
}

/** Provider 显示名映射（与设置页一致的简洁标签） */
export const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  ppio: 'PPIO',
  fal: 'Fal',
  kie: 'KIE',
  modelscope: 'ModelScope',
  bailian: 'Bailian',
};

export function getProviderDisplayName(providerId: string, locale?: string): string {
  const normalizedProviderId = providerId.toLowerCase();
  if (locale?.toLowerCase().startsWith('zh') && normalizedProviderId === 'bailian') {
    return '百炼';
  }
  return PROVIDER_DISPLAY_NAMES[normalizedProviderId] ?? (providerId ? providerId.toUpperCase() : 'Unknown');
}
