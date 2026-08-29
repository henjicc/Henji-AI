import { registry } from '@/core/ModelRegistry';
import { derivedMediaStateKey } from '@/core/params/derivedMediaState';
import type { PromptMediaBinding } from '@/core/inputs/promptDocument';
import { createPlainTextPromptDocument } from '@/core/inputs/promptDocument';
import {
  analyzeRatioResolutionParams,
  isSmartAspectValue,
} from '@/core/params/ratioResolution';

import {
  CANVAS_NODE_TYPES,
  CANVAS_IMAGE_RESULT_KINDS,
  type CanvasNode,
  type CanvasNodeType,
  type ExportImageNodeResultKind,
} from './canvasNodes';
import { getDefaultModelId } from './defaultModels';
import { getCanvasNodeDefinition } from './nodeRegistry';
import { hasResumableServerTask } from './resumableTask';
import { resolveMediaTargetHandle, type RowMediaKind } from './socketTypes';
import { DEFAULT_NODE_DISPLAY_NAME } from './nodeDisplay';
import { CANVAS_IMAGE_CAPABILITY_IDS } from '../capabilities/types';
import {
  mapCanvasCapabilityModelParams,
  resolveCanvasCapabilityModelCandidates,
} from '../capabilities/modelCompatibility';
import {
  PANORAMA_MODEL_POLICY,
  PANORAMA_PROMPT_POLICY,
  PANORAMA_REFERENCE_TEMPLATE_VERSION,
  PANORAMA_TEXT_TEMPLATE_VERSION,
} from '../capabilities/panoramaPolicy';
import {
  normalizeRelightSettings,
  prepareRelightRoute,
} from '../capabilities/relightPolicy';
import { UPSCALE_MODEL_POLICY } from '../capabilities/upscalePolicy';
import {
  ELEMENT_EDIT_FIXED_SEMANTIC_PARAMS,
  ELEMENT_EDIT_MODEL_POLICY,
  ELEMENT_EDIT_PROMPT_TEMPLATE_VERSION,
  resolveElementEditMaskParam,
  selectDefaultElementEditModel,
} from '../capabilities/elementEditPolicy';
import {
  MULTI_ANGLE_CONTINUOUS_MODEL_ID,
  MULTI_ANGLE_DISCRETE_MODEL_ID,
  createDefaultMultiAngleConfig,
  normalizeMultiAngleConfig,
} from '../capabilities/multiAnglePolicy';
import {
  PORTRAIT_TEXTURE_DEFAULT_MODEL_ID,
  PORTRAIT_TEXTURE_TEMPLATE_VERSION,
  normalizePortraitTextureSettings,
  preparePortraitTextureRoute,
} from '../capabilities/portraitTexturePolicy';

const LEGACY_TARGET_HANDLE_ID = 'target';
const LEGACY_GENERATION_DISPLAY_NAMES: Partial<Record<CanvasNodeType, string>> = {
  [CANVAS_NODE_TYPES.imageEdit]: 'AI 图片',
  [CANVAS_NODE_TYPES.videoGen]: 'AI 视频',
  [CANVAS_NODE_TYPES.audioGen]: 'AI 音频',
  [CANVAS_NODE_TYPES.textAnnotation]: '文本注释',
};

const LEGACY_EXPORT_RESULT_KINDS = new Set<ExportImageNodeResultKind>([
  'generic',
  'storyboardGenOutput',
  'storyboardSplitExport',
  'storyboardFrameEdit',
]);
const CANVAS_IMAGE_RESULT_KIND_SET = new Set<ExportImageNodeResultKind>(
  CANVAS_IMAGE_RESULT_KINDS
);

/**
 * 结果节点语义是可持久化契约：旧来源值继续可读，缺失或损坏值降级为普通图片。
 * 图片组和图层栈只在此层保留语义，不在本迁移中创建对应业务节点。
 */
export function migrateExportImageResultKind(data: DynamicValueMap): void {
  const resultKind = data.resultKind;
  if (
    typeof resultKind === 'string'
    && (
      LEGACY_EXPORT_RESULT_KINDS.has(resultKind as ExportImageNodeResultKind)
      || CANVAS_IMAGE_RESULT_KIND_SET.has(resultKind as ExportImageNodeResultKind)
    )
  ) {
    return;
  }
  data.resultKind = 'image';
}

/** 只迁移精确匹配的旧默认标题，用户自行编辑过的标题保持原样。 */
export function migrateLegacyGenerationDisplayName(
  nodeType: CanvasNodeType,
  data: DynamicValueMap
): void {
  const legacyName = LEGACY_GENERATION_DISPLAY_NAMES[nodeType];
  if (legacyName && data.displayName === legacyName) {
    data.displayName = DEFAULT_NODE_DISPLAY_NAME[nodeType];
  }
}

function isPromptMediaBinding(value: unknown): value is PromptMediaBinding {
  if (!value || typeof value !== 'object') return false;
  const binding = value as Partial<PromptMediaBinding>;
  return typeof binding.resourceId === 'string'
    && binding.resourceId.trim().length > 0
    && (binding.mediaType === 'image' || binding.mediaType === 'video' || binding.mediaType === 'audio')
    && (typeof binding.dataUrl === 'string' || typeof binding.filePath === 'string');
}

/**
 * 标准生成节点提示词载体的轻量迁移：兼容字段始终为字符串，binding 只保留合法记录。
 * promptDocument 的完整版本校验由共享核心 adapter 负责，以便损坏数据能记录降级诊断。
 */
export function migrateGenerationPromptData(data: DynamicValueMap): void {
  if (typeof data.prompt !== 'string') {
    data.prompt = '';
  }
  if (data.promptMediaBindings === undefined) return;
  data.promptMediaBindings = Array.isArray(data.promptMediaBindings)
    ? data.promptMediaBindings.filter(isPromptMediaBinding)
    : [];
}

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
  data.imageExporting = false;
  data.imageRenderRequestId = null;
  data.imageRenderError = null;
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

/** 恢复全景节点被旧工程或损坏数据覆盖的能力固定语义。 */
export function migratePanoramaGenerationData(data: DynamicValueMap): void {
  data.capabilityId = CANVAS_IMAGE_CAPABILITY_IDS.panorama;
  data.fixedSemanticParams = { ...PANORAMA_PROMPT_POLICY.fixedSemanticParams };

  const mediaInputs = data.mediaInputs && typeof data.mediaInputs === 'object'
    ? data.mediaInputs as DynamicValueMap
    : {};
  const inlineImages = Array.isArray(mediaInputs.image)
    ? mediaInputs.image.filter((value): value is string => typeof value === 'string').slice(0, 1)
    : [];
  data.mediaInputs = { ...mediaInputs, image: inlineImages };
  data.promptTemplateVersion = inlineImages.length > 0
    ? PANORAMA_REFERENCE_TEMPLATE_VERSION
    : PANORAMA_TEXT_TEMPLATE_VERSION;

  const compatibleModels = resolveCanvasCapabilityModelCandidates(
    registry.getModelsByType('image'),
    PANORAMA_MODEL_POLICY,
  ).candidates;
  const storedModelId = typeof data.modelId === 'string' ? data.modelId.trim() : '';
  const selectedModel = compatibleModels.find(({ model }) => model.meta.id === storedModelId)?.model
    ?? compatibleModels[0]?.model;
  if (!selectedModel) return;
  data.modelId = selectedModel.meta.id;
  const storedParams = data.params && typeof data.params === 'object'
    ? data.params as DynamicValueMap
    : {};
  data.params = mapCanvasCapabilityModelParams(
    selectedModel,
    PANORAMA_MODEL_POLICY,
    storedParams,
  ).params;
}

/** 恢复图片打光节点的版本化设置、显式模式路由和普通图片输出语义。 */
export function migrateRelightGenerationData(data: DynamicValueMap): void {
  data.capabilityId = CANVAS_IMAGE_CAPABILITY_IDS.relight;
  const mediaInputs = data.mediaInputs && typeof data.mediaInputs === 'object'
    ? data.mediaInputs as DynamicValueMap
    : {};
  const inlineImages = Array.isArray(mediaInputs.image)
    ? mediaInputs.image.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  if (inlineImages.length > 1) {
    data.relightRouteReasons = ['图片打光必须且只能提供 1 张源图'];
  }
  data.mediaInputs = { ...mediaInputs, image: inlineImages };

  let settings;
  try {
    settings = normalizeRelightSettings(data.relightSettings);
  } catch (error) {
    data.relightRouteReasons = [error instanceof Error ? error.message : '打光设置无法迁移'];
    return;
  }
  const route = prepareRelightRoute(
    settings,
    registry.getModelsByType('image'),
    data.params && typeof data.params === 'object' ? data.params as DynamicValueMap : {},
  );
  data.relightSettings = settings;
  data.prompt = route.prompt;
  data.promptDocument = createPlainTextPromptDocument(route.prompt);
  data.promptTemplateVersion = route.templateVersion;
  data.modelId = route.model?.meta.id ?? '';
  data.params = route.params;
  data.lightingReferenceImages = settings.lightingMode === 'smart'
    ? [...settings.smart.lightingReferenceImages]
    : [];
  data.relightRouteReasons = [...route.reasons];
}

/** 恢复高清放大节点的唯一模型、单图输入与本地预检上限。 */
export function migrateUpscaleGenerationData(data: DynamicValueMap): void {
  data.capabilityId = CANVAS_IMAGE_CAPABILITY_IDS.upscale;
  data.prompt = '';
  data.promptTemplateVersion = null;
  data.fixedSemanticParams = {
    maxOutputMegapixels: 48,
    maxInputFileBytes: 20 * 1024 * 1024,
  };

  const mediaInputs = data.mediaInputs && typeof data.mediaInputs === 'object'
    ? data.mediaInputs as DynamicValueMap
    : {};
  const inlineImages = Array.isArray(mediaInputs.image)
    ? mediaInputs.image.filter(
      (value): value is string => typeof value === 'string' && value.trim().length > 0,
    ).slice(0, 1)
    : [];
  data.mediaInputs = { ...mediaInputs, image: inlineImages };

  const compatibleModels = resolveCanvasCapabilityModelCandidates(
    registry.getModelsByType('image'),
    UPSCALE_MODEL_POLICY,
  ).candidates;
  const storedModelId = typeof data.modelId === 'string' ? data.modelId.trim() : '';
  const selectedModel = compatibleModels.find(({ model }) => model.meta.id === storedModelId)?.model
    ?? compatibleModels[0]?.model;
  if (!selectedModel) return;
  data.modelId = selectedModel.meta.id;
  const storedParams = data.params && typeof data.params === 'object'
    ? data.params as DynamicValueMap
    : {};
  const supportedParamIds = new Set(selectedModel.params.map((param) => param.id));
  const supportedStoredParams = Object.fromEntries(
    Object.entries(storedParams).filter(([paramId]) => supportedParamIds.has(paramId)),
  ) as DynamicValueMap;
  data.params = mapCanvasCapabilityModelParams(
    selectedModel,
    UPSCALE_MODEL_POLICY,
    supportedStoredParams,
  ).params;
}

/** 恢复人像质感的版本化设置、显式模型路由与单图输入约束。 */
export function migratePortraitTextureGenerationData(data: DynamicValueMap): void {
  data.capabilityId = CANVAS_IMAGE_CAPABILITY_IDS.portraitTexture;
  data.promptTemplateVersion = PORTRAIT_TEXTURE_TEMPLATE_VERSION;
  data.fixedSemanticParams = { portraitTextureContractVersion: 1 };

  const mediaInputs = data.mediaInputs && typeof data.mediaInputs === 'object'
    ? data.mediaInputs as DynamicValueMap
    : {};
  const inlineImages = Array.isArray(mediaInputs.image)
    ? mediaInputs.image.filter(
      (value): value is string => typeof value === 'string' && value.trim().length > 0,
    )
    : [];
  data.mediaInputs = { ...mediaInputs, image: inlineImages };
  const sourceReasons = inlineImages.length > 1
    ? ['人像质感调节必须且只能提供 1 张源图']
    : [];

  let settings;
  try {
    settings = normalizePortraitTextureSettings(data.portraitTextureSettings);
  } catch (error) {
    data.portraitTextureRouteReasons = [
      ...sourceReasons,
      error instanceof Error ? error.message : '人像质感设置无法迁移',
    ];
    return;
  }

  const storedModelId = typeof data.modelId === 'string' && data.modelId.trim()
    ? data.modelId.trim()
    : PORTRAIT_TEXTURE_DEFAULT_MODEL_ID;
  const route = preparePortraitTextureRoute(
    settings,
    registry.getModelsByType('image'),
    storedModelId,
    data.params && typeof data.params === 'object' ? data.params as DynamicValueMap : {},
  );
  data.portraitTextureSettings = settings;
  data.modelId = storedModelId;
  data.params = route.params;
  data.prompt = route.prompt;
  data.promptDocument = createPlainTextPromptDocument(route.prompt);
  data.portraitTextureRouteReasons = [...sourceReasons, ...route.reasons];
}

/** 恢复元素编辑的真实遮罩模型、单图输入和可编辑文档，不迁移跨模型遮罩。 */
export function migrateElementEditGenerationData(data: DynamicValueMap): void {
  data.capabilityId = CANVAS_IMAGE_CAPABILITY_IDS.elementEdit;
  data.promptTemplateVersion = ELEMENT_EDIT_PROMPT_TEMPLATE_VERSION;
  data.fixedSemanticParams = { ...ELEMENT_EDIT_FIXED_SEMANTIC_PARAMS };

  const mediaInputs = data.mediaInputs && typeof data.mediaInputs === 'object'
    ? data.mediaInputs as DynamicValueMap
    : {};
  const inlineImages = Array.isArray(mediaInputs.image)
    ? mediaInputs.image.filter(
      (value): value is string => typeof value === 'string' && value.trim().length > 0,
    ).slice(0, 1)
    : [];
  data.mediaInputs = { ...mediaInputs, image: inlineImages };

  const candidates = resolveCanvasCapabilityModelCandidates(
    registry.getModelsByType('image'),
    ELEMENT_EDIT_MODEL_POLICY,
  ).candidates.map(({ model }) => model);
  const storedModelId = typeof data.modelId === 'string' ? data.modelId.trim() : '';
  const selectedModel = candidates.find((model) => model.meta.id === storedModelId)
    ?? selectDefaultElementEditModel(candidates);
  if (!selectedModel) return;

  const maskParam = resolveElementEditMaskParam(selectedModel);
  const supportedParamIds = new Set(selectedModel.params.map((param) => param.id));
  if (maskParam) supportedParamIds.add(derivedMediaStateKey(maskParam.id));
  const storedParams = data.params && typeof data.params === 'object'
    ? data.params as DynamicValueMap
    : {};
  const supportedStoredParams = Object.fromEntries(
    Object.entries(storedParams).filter(([paramId]) => supportedParamIds.has(paramId)),
  ) as DynamicValueMap;
  data.modelId = selectedModel.meta.id;
  data.params = mapCanvasCapabilityModelParams(
    selectedModel,
    ELEMENT_EDIT_MODEL_POLICY,
    supportedStoredParams,
  ).params;
}

/** 恢复多角度节点的版本化 profile、隐藏执行模型与单图输入。 */
export function migrateMultiAngleGenerationData(data: DynamicValueMap): void {
  data.capabilityId = CANVAS_IMAGE_CAPABILITY_IDS.multiAngle;
  data.prompt = '';
  data.params = {};
  let config;
  try {
    config = normalizeMultiAngleConfig(data.multiAngleConfig);
  } catch {
    config = createDefaultMultiAngleConfig();
    data.multiAngleBatch = null;
  }
  data.multiAngleConfig = config;
  data.modelId = config.controlProfile === 'continuous-v1'
    ? MULTI_ANGLE_CONTINUOUS_MODEL_ID
    : MULTI_ANGLE_DISCRETE_MODEL_ID;

  const mediaInputs = data.mediaInputs && typeof data.mediaInputs === 'object'
    ? data.mediaInputs as DynamicValueMap
    : {};
  const inlineImages = Array.isArray(mediaInputs.image)
    ? mediaInputs.image.filter(
      (value): value is string => typeof value === 'string' && value.trim().length > 0,
    ).slice(0, 1)
    : [];
  data.mediaInputs = { ...mediaInputs, image: inlineImages };
  if (typeof data.multiAngleResultPlaceholderId !== 'string') {
    data.multiAngleResultPlaceholderId = null;
  }
}
