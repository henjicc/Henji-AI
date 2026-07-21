import { registry } from '@/core/ModelRegistry';
import {
  analyzeRatioResolutionParams,
  isSmartAspectValue,
} from '@/core/params/ratioResolution';

import {
  CANVAS_NODE_TYPES,
  type CanvasNode,
  type CanvasNodeType,
} from './canvasNodes';
import { getDefaultModelId } from './defaultModels';
import { getCanvasNodeDefinition } from './nodeRegistry';
import { hasResumableServerTask } from './resumableTask';
import { resolveMediaTargetHandle, type RowMediaKind } from './socketTypes';

const LEGACY_TARGET_HANDLE_ID = 'target';

/**
 * 清理无法跨应用生命周期恢复的节点运行态。
 * 直接修改传入对象；调用方应传入节点数据副本，避免影响当前运行中的任务。
 */
export function resetTransientNodeRuntimeState(
  nodeType: CanvasNodeType,
  data: DynamicValueMap
): void {
  // 已登记服务端任务 ID 的生成中节点是可恢复的：任务还在供应商那边跑，
  // 清成 false 会让重启后既看不到进度、也再没人去取结果。保留生成态，
  // 交给 useCanvasResumePolling 接着轮询。
  if (data.isGenerating === true && !hasResumableServerTask(data)) {
    data.isGenerating = false;
    if ('generationStartedAt' in data) {
      data.generationStartedAt = null;
    }
  }

  if (nodeType !== CANVAS_NODE_TYPES.cameraStage) {
    return;
  }

  data.videoExporting = false;
  data.videoProgress = null;
  data.videoRenderPhase = null;
  data.videoRenderRequestId = null;
  data.videoRenderError = null;
}

/**
 * 节点由旧版单一 target Handle 迁移为逐行媒体端口（connectivity.targetHandleMode: 'rows'）后，
 * 历史画布里残留的 'target' 连线需要重新指向对应媒体类型的专属端口，否则连线会失去锚点。
 * 仅在该节点只声明了一种可接受媒体类型时才能无歧义推断；多媒体类型节点保留原值不处理。
 */
export function migrateLegacyTargetHandle(targetNode: CanvasNode, targetHandle: string): string {
  if (targetHandle !== LEGACY_TARGET_HANDLE_ID) {
    return targetHandle;
  }

  const definition = getCanvasNodeDefinition(targetNode.type);
  if (definition?.connectivity.targetHandleMode !== 'rows') {
    return targetHandle;
  }

  const acceptedRowKinds = (definition.ports?.target?.accepts ?? []).filter(
    (kind): kind is RowMediaKind => kind === 'image' || kind === 'video' || kind === 'audio'
  );
  if (acceptedRowKinds.length !== 1) {
    return targetHandle;
  }

  return resolveMediaTargetHandle(targetNode.type, acceptedRowKinds[0]);
}

/**
 * 旧版生成节点数据（model/size/requestAspectRatio/extraParams）
 * 迁移为新版 schema 驱动结构（modelId/params）。
 *
 * 迁移是幂等的：已迁移的数据只做旧键清理。
 */

const LEGACY_KEYS = ['model', 'size', 'requestAspectRatio', 'extraParams'] as const;

function resolveMigratedModelId(legacyModelId: DynamicValue): string {
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
  legacy: DynamicValueMap
): DynamicValueMap {
  const schema = registry.getSchema(modelId);
  const params: DynamicValueMap = {};

  const legacyExtraParams = legacy.extraParams;
  if (legacyExtraParams && typeof legacyExtraParams === 'object') {
    const schemaIds = new Set(schema.map((param) => param.id));
    for (const [key, value] of Object.entries(legacyExtraParams as DynamicValueMap)) {
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

function stripLegacyKeys(data: DynamicValueMap): void {
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
export function migrateGenerationNodeData(data: DynamicValueMap): void {
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
    ...((data.params && typeof data.params === 'object') ? (data.params as DynamicValueMap) : {}),
  };
  stripLegacyKeys(data);
}
