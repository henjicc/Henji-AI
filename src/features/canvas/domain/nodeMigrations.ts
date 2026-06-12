import { registry } from '@/core/ModelRegistry';
import {
  analyzeRatioResolutionParams,
  isSmartAspectValue,
} from '@/core/params/ratioResolution';

import { getDefaultModelId } from './defaultModels';

/**
 * 旧版生成节点数据（model/size/requestAspectRatio/extraParams）
 * 迁移为新版 schema 驱动结构（modelId/params）。
 *
 * 迁移是幂等的：已迁移的数据只做旧键清理。
 */

const LEGACY_KEYS = ['model', 'size', 'requestAspectRatio', 'extraParams'] as const;

function resolveMigratedModelId(legacyModelId: unknown): string {
  const requested = typeof legacyModelId === 'string' ? legacyModelId.trim() : '';
  if (requested && registry.getModel(requested)) {
    return requested;
  }

  const imageModels = registry.getModelsByType('image');
  if (requested) {
    const shortId = requested.includes('/') ? requested.split('/').pop() ?? requested : requested;
    const matched = imageModels.find(
      (model) =>
        model.meta.id === requested
        || model.meta.id === shortId
        || (model.meta.aliases ?? []).includes(requested)
        || model.meta.id.endsWith(`/${shortId}`)
    );
    if (matched) {
      return matched.meta.id;
    }
  }

  return getDefaultModelId('image');
}

function buildMigratedParams(
  modelId: string,
  legacy: Record<string, unknown>
): Record<string, unknown> {
  const schema = registry.getSchema(modelId);
  const params: Record<string, unknown> = {};

  const legacyExtraParams = legacy.extraParams;
  if (legacyExtraParams && typeof legacyExtraParams === 'object') {
    const schemaIds = new Set(schema.map((param) => param.id));
    for (const [key, value] of Object.entries(legacyExtraParams as Record<string, unknown>)) {
      if (schemaIds.has(key)) {
        params[key] = value;
      }
    }
  }

  const spec = analyzeRatioResolutionParams(schema, []);

  const legacyAspect = typeof legacy.requestAspectRatio === 'string' ? legacy.requestAspectRatio : '';
  if (spec?.aspectParam) {
    if (legacyAspect && legacyAspect !== 'auto') {
      const matched = spec.aspectParam.options.find((option) => option.value === legacyAspect);
      if (matched) {
        params[spec.aspectParam.id] = matched.value;
      }
    } else if (legacyAspect === 'auto') {
      const smartOption = spec.aspectParam.options.find((option) => isSmartAspectValue(option.value));
      if (smartOption) {
        params[spec.aspectParam.id] = smartOption.value;
      }
    }
  }

  const legacySize = typeof legacy.size === 'string' ? legacy.size : '';
  if (legacySize && spec?.resolutionParam) {
    const matched = spec.resolutionParam.options.find((option) => option.value === legacySize);
    if (matched) {
      params[spec.resolutionParam.id] = matched.value;
    }
  }

  return params;
}

function stripLegacyKeys(data: Record<string, unknown>): void {
  for (const key of LEGACY_KEYS) {
    if (key in data) {
      delete data[key];
    }
  }
}

/**
 * 迁移生成类节点（AI 图片 / 分镜生成）的模型数据。
 * 直接修改传入对象（normalizeNodes 中的 mergedData 是新对象，安全）。
 */
export function migrateGenerationNodeData(data: Record<string, unknown>): void {
  // 模型清单尚未加载时跳过，等待下次 normalize
  if (registry.getModelsByType('image').length === 0) {
    return;
  }

  const existingModelId = typeof data.modelId === 'string' ? data.modelId.trim() : '';
  if (existingModelId && registry.getModel(existingModelId)) {
    stripLegacyKeys(data);
    if (!data.params || typeof data.params !== 'object') {
      data.params = {};
    }
    return;
  }

  const modelId = resolveMigratedModelId(data.model);
  const params = buildMigratedParams(modelId, data);

  data.modelId = modelId;
  data.params = {
    ...params,
    ...((data.params && typeof data.params === 'object') ? (data.params as Record<string, unknown>) : {}),
  };
  stripLegacyKeys(data);
}
