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
