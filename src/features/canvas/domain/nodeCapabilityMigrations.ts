import { createPlainTextPromptDocument } from '@/core/inputs/promptDocument';
import { registry } from '@/core/ModelRegistry';

import {
  mapCanvasCapabilityModelParams,
  resolveCanvasCapabilityModelCandidates,
} from '../capabilities/modelCompatibility';
import { normalizeNineGridStoryboardData } from '../capabilities/nineGridPolicy';
import {
  PANORAMA_DEFAULT_PROMPT,
  PANORAMA_DEFAULT_PROMPT_VERSION,
  PANORAMA_MODEL_POLICY,
  PANORAMA_PROMPT_POLICY,
  PANORAMA_REFERENCE_TEMPLATE_VERSION,
  PANORAMA_TEXT_TEMPLATE_VERSION,
} from '../capabilities/panoramaPolicy';
import {
  normalizeRelightSettings,
  prepareRelightRoute,
} from '../capabilities/relightPolicy';
import {
  UPSCALE_DEFAULT_CANONICAL_MODEL_ID,
  UPSCALE_MODEL_POLICY,
} from '../capabilities/upscalePolicy';
import {
  DEFAULT_LOCAL_REDRAW_SETTINGS,
  ELEMENT_EDIT_FIXED_SEMANTIC_PARAMS,
  ELEMENT_EDIT_MODEL_POLICY,
  ELEMENT_EDIT_PROMPT_TEMPLATE_VERSION,
  normalizeLocalRedrawSettings,
  selectDefaultElementEditModel,
} from '../capabilities/elementEditPolicy';
import {
  createDefaultMultiAngleConfig,
  normalizeMultiAngleConfig,
  resolveMultiAngleExecutionTarget,
} from '../capabilities/multiAnglePolicy';
import {
  PORTRAIT_TEXTURE_DEFAULT_MODEL_ID,
  PORTRAIT_TEXTURE_TEMPLATE_VERSION,
  normalizePortraitTextureSettings,
  preparePortraitTextureRoute,
} from '../capabilities/portraitTexturePolicy';
import {
  LAYER_SEPARATION_DEFAULT_MODEL_ID,
  LAYER_SEPARATION_MODEL_POLICY,
  LAYER_STACK_CONTRACT_VERSION,
  selectDefaultLayerSeparationModel,
} from '../capabilities/layerSeparationPolicy';
import { CANVAS_IMAGE_CAPABILITY_IDS } from '../capabilities/types';
import { validateLayerStackDocument, type LayerStackDocumentV1 } from './layerStack';

/** 恢复全景节点被旧工程或损坏数据覆盖的能力固定语义。 */
export function migratePanoramaGenerationData(data: DynamicValueMap): void {
  data.capabilityId = CANVAS_IMAGE_CAPABILITY_IDS.panorama;
  data.fixedSemanticParams = { ...PANORAMA_PROMPT_POLICY.fixedSemanticParams };
  if (data.defaultPromptVersion !== PANORAMA_DEFAULT_PROMPT_VERSION) {
    const storedPrompt = typeof data.prompt === 'string' ? data.prompt.trim() : '';
    if (storedPrompt.length === 0) {
      data.prompt = PANORAMA_DEFAULT_PROMPT;
      data.promptDocument = createPlainTextPromptDocument(PANORAMA_DEFAULT_PROMPT);
    }
    data.defaultPromptVersion = PANORAMA_DEFAULT_PROMPT_VERSION;
  }

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

/** 恢复高清放大节点的可用模型、单图输入与预检契约。 */
export function migrateUpscaleGenerationData(data: DynamicValueMap): void {
  data.capabilityId = CANVAS_IMAGE_CAPABILITY_IDS.upscale;
  data.prompt = '';
  data.promptTemplateVersion = null;
  data.fixedSemanticParams = {
    upscaleContractVersion: 2,
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
    ?? compatibleModels.find(
      ({ model }) => model.meta.canonicalModelId === UPSCALE_DEFAULT_CANONICAL_MODEL_ID,
    )?.model
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

/** 恢复局部重绘的通用编辑模型、单图输入和本地裁剪/配准设置。 */
export function migrateElementEditGenerationData(data: DynamicValueMap): void {
  data.capabilityId = CANVAS_IMAGE_CAPABILITY_IDS.elementEdit;
  data.promptTemplateVersion = ELEMENT_EDIT_PROMPT_TEMPLATE_VERSION;
  data.fixedSemanticParams = { ...ELEMENT_EDIT_FIXED_SEMANTIC_PARAMS };
  data.localRedrawSettings = normalizeLocalRedrawSettings(
    data.localRedrawSettings ?? DEFAULT_LOCAL_REDRAW_SETTINGS,
  );

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

  const supportedParamIds = new Set(selectedModel.params.map((param) => param.id));
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

/** 保存重开后恢复唯一图层拆分模式、单图输入和原厂优先模型。 */
export function migrateLayerSeparationGenerationData(data: DynamicValueMap): void {
  data.capabilityId = CANVAS_IMAGE_CAPABILITY_IDS.layerSeparation;
  data.promptTemplateVersion = null;
  data.fixedSemanticParams = { layerStackContractVersion: LAYER_STACK_CONTRACT_VERSION };
  const mediaInputs = data.mediaInputs && typeof data.mediaInputs === 'object'
    ? data.mediaInputs as DynamicValueMap
    : {};
  const inlineImages = Array.isArray(mediaInputs.image)
    ? mediaInputs.image.filter((value): value is string => typeof value === 'string' && value.trim().length > 0).slice(0, 1)
    : [];
  data.mediaInputs = { ...mediaInputs, image: inlineImages };
  const candidates = resolveCanvasCapabilityModelCandidates(
    registry.getModelsByType('image'),
    LAYER_SEPARATION_MODEL_POLICY,
  ).candidates.map(({ model }) => model);
  const storedModelId = typeof data.modelId === 'string' ? data.modelId.trim() : '';
  const model = candidates.find((candidate) => candidate.meta.id === storedModelId)
    ?? selectDefaultLayerSeparationModel(candidates);
  data.modelId = model?.meta.id ?? LAYER_SEPARATION_DEFAULT_MODEL_ID;
  if (!model) return;
  const supportedParamIds = new Set(model.params.map((param) => param.id));
  const storedParams = data.params && typeof data.params === 'object' ? data.params as DynamicValueMap : {};
  data.params = mapCanvasCapabilityModelParams(
    model,
    LAYER_SEPARATION_MODEL_POLICY,
    Object.fromEntries(Object.entries(storedParams).filter(([key]) => supportedParamIds.has(key))),
  ).params;
}

/** 未知/损坏文档不猜测迁移，保留合成图并降级为普通可连接图片。 */
export function migrateLayerStackResultData(data: DynamicValueMap): void {
  try {
    validateLayerStackDocument(data.layerStackDocument as unknown as LayerStackDocumentV1);
    data.resultKind = 'layer-stack';
  } catch {
    data.resultKind = 'image';
    delete data.layerStackDocument;
  }
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
  data.modelId = resolveMultiAngleExecutionTarget(config.controlProfile).modelId;

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

/** 固定九宫格预设保存重开后仍保持 3×3、九格和当前提示词契约。 */
export function migrateStoryboardGenerationData(data: DynamicValueMap): void {
  normalizeNineGridStoryboardData(data);
}
