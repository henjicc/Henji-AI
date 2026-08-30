import { registry } from '@/core/ModelRegistry';

import {
  DEFAULT_LOCAL_REDRAW_SETTINGS,
  ELEMENT_EDIT_FIXED_SEMANTIC_PARAMS,
  ELEMENT_EDIT_DEFAULT_MODEL_ID,
  ELEMENT_EDIT_MODEL_POLICY,
  ELEMENT_EDIT_PROMPT_TEMPLATE_VERSION,
  selectDefaultElementEditModel,
} from '../capabilities/elementEditPolicy';
import {
  LAYER_SEPARATION_DEFAULT_MODEL_ID,
  LAYER_SEPARATION_MODEL_POLICY,
  LAYER_STACK_CONTRACT_VERSION,
  selectDefaultLayerSeparationModel,
} from '../capabilities/layerSeparationPolicy';
import {
  MULTI_ANGLE_CONTINUOUS_MODEL_ID,
  createDefaultMultiAngleConfig,
} from '../capabilities/multiAnglePolicy';
import {
  DEFAULT_PORTRAIT_TEXTURE_SETTINGS,
  PORTRAIT_TEXTURE_DEFAULT_MODEL_ID,
  PORTRAIT_TEXTURE_TEMPLATE_VERSION,
  preparePortraitTextureRoute,
} from '../capabilities/portraitTexturePolicy';
import {
  DEFAULT_RELIGHT_SETTINGS,
  prepareRelightRoute,
} from '../capabilities/relightPolicy';
import {
  UPSCALE_DEFAULT_CANONICAL_MODEL_ID,
  UPSCALE_MODEL_POLICY,
} from '../capabilities/upscalePolicy';
import {
  mapCanvasCapabilityModelParams,
  resolveCanvasCapabilityModelCandidates,
} from '../capabilities/modelCompatibility';
import { CANVAS_IMAGE_CAPABILITY_IDS } from '../capabilities/types';
import {
  CANVAS_NODE_TYPES,
  DEFAULT_ASPECT_RATIO,
  type ElementEditGenerationNodeData,
  type ImageEditNodeData,
  type LayerSeparationGenerationNodeData,
  type LayerStackResultNodeData,
  type MultiAngleGenerationNodeData,
  type PortraitTextureGenerationNodeData,
  type UpscaleGenerationNodeData,
} from './canvasNodes';
import { DEFAULT_NODE_DISPLAY_NAME } from './nodeDisplay';
import { imageOutputsFromData } from './nodeRegistryMediaOutputs';
import type { CanvasNodeDefinition } from './nodeRegistryContracts';

function createRelightGenerationDefaultData(): ImageEditNodeData {
  const settings = {
    ...DEFAULT_RELIGHT_SETTINGS,
    manual: { ...DEFAULT_RELIGHT_SETTINGS.manual },
    smart: { ...DEFAULT_RELIGHT_SETTINGS.smart, lightingReferenceImages: [] },
  };
  const route = prepareRelightRoute(settings, registry.getModelsByType('image'));
  return {
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.relightGen],
    imageUrl: null,
    previewImageUrl: null,
    aspectRatio: DEFAULT_ASPECT_RATIO,
    isSizeManuallyAdjusted: false,
    prompt: route.prompt,
    modelId: route.model?.meta.id ?? '',
    params: route.params,
    mediaInputs: {},
    isGenerating: false,
    generationStartedAt: null,
    generationDurationMs: undefined,
    capabilityId: CANVAS_IMAGE_CAPABILITY_IDS.relight,
    relightSettings: settings as unknown as DynamicValue,
    promptTemplateVersion: route.templateVersion,
    lightingReferenceImages: [],
    relightRouteReasons: route.reasons,
  };
}

export const relightGenerationNodeDefinition: CanvasNodeDefinition<ImageEditNodeData> = {
  type: CANVAS_NODE_TYPES.relightGen,
  menuLabelKey: 'node.menu.relightGeneration',
  menuIcon: 'imageGeneration',
  visibleInMenu: false,
  executionKind: 'standard-generation',
  capabilities: {
    toolbar: true,
    promptInput: false,
    toolbarGenerate: true,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: { fromSource: true, fromTarget: false },
    targetHandleMode: 'rows',
  },
  media: { kind: 'image', role: 'generator' },
  ports: {
    source: { emits: 'image' },
    target: { accepts: ['image'] },
  },
  generation: {
    modelType: 'image',
    resultNodeType: CANVAS_NODE_TYPES.exportImage,
  },
  getOutputs: imageOutputsFromData,
  createDefaultData: createRelightGenerationDefaultData,
};

function createMultiAngleGenerationDefaultData(): MultiAngleGenerationNodeData {
  return {
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.multiAngleGen],
    imageUrl: null,
    previewImageUrl: null,
    aspectRatio: DEFAULT_ASPECT_RATIO,
    isSizeManuallyAdjusted: false,
    prompt: '',
    modelId: MULTI_ANGLE_CONTINUOUS_MODEL_ID,
    params: {},
    mediaInputs: {},
    isGenerating: false,
    generationStartedAt: null,
    generationDurationMs: undefined,
    capabilityId: CANVAS_IMAGE_CAPABILITY_IDS.multiAngle,
    multiAngleConfig: createDefaultMultiAngleConfig() as unknown as DynamicValueMap,
    multiAngleBatch: null,
    multiAngleResultPlaceholderId: null,
  };
}

export const multiAngleGenerationNodeDefinition: CanvasNodeDefinition<MultiAngleGenerationNodeData> = {
  type: CANVAS_NODE_TYPES.multiAngleGen,
  menuLabelKey: 'node.menu.multiAngleGeneration',
  menuIcon: 'imageGeneration',
  visibleInMenu: false,
  executionKind: 'standard-generation',
  capabilities: {
    toolbar: true,
    promptInput: false,
    toolbarGenerate: true,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: { fromSource: true, fromTarget: false },
    targetHandleMode: 'rows',
  },
  media: { kind: 'image', role: 'generator' },
  ports: {
    source: { emits: 'image' },
    target: { accepts: ['image'] },
  },
  generation: {
    modelType: 'image',
    resultNodeType: CANVAS_NODE_TYPES.exportImage,
  },
  getOutputs: imageOutputsFromData,
  createDefaultData: createMultiAngleGenerationDefaultData,
};

function createUpscaleGenerationDefaultData(): UpscaleGenerationNodeData {
  const compatibleModels = resolveCanvasCapabilityModelCandidates(
    registry.getModelsByType('image'),
    UPSCALE_MODEL_POLICY,
  ).candidates;
  const modelId = compatibleModels.find(
    ({ model: candidate }) => candidate.meta.canonicalModelId === UPSCALE_DEFAULT_CANONICAL_MODEL_ID,
  )?.model.meta.id ?? compatibleModels[0]?.model.meta.id ?? 'fal-ai-topaz-image-upscale';
  const model = registry.getModel(modelId);
  const params = model
    ? mapCanvasCapabilityModelParams(model, UPSCALE_MODEL_POLICY).params
    : {
        falTopazUpscaleMode: 'precision',
        falTopazPrecisionModel: 'High Fidelity V3',
        falTopazUpscaleFactor: 2,
        falTopazFaceEnhancement: false,
      };
  return {
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.upscaleGen],
    imageUrl: null,
    previewImageUrl: null,
    aspectRatio: DEFAULT_ASPECT_RATIO,
    isSizeManuallyAdjusted: false,
    prompt: '',
    modelId,
    params,
    mediaInputs: {},
    isGenerating: false,
    generationStartedAt: null,
    generationDurationMs: undefined,
    capabilityId: CANVAS_IMAGE_CAPABILITY_IDS.upscale,
    promptTemplateVersion: null,
    fixedSemanticParams: {
      upscaleContractVersion: 2,
    },
  };
}

export const upscaleGenerationNodeDefinition: CanvasNodeDefinition<UpscaleGenerationNodeData> = {
  type: CANVAS_NODE_TYPES.upscaleGen,
  menuLabelKey: 'node.menu.upscaleGeneration',
  menuIcon: 'imageGeneration',
  visibleInMenu: false,
  executionKind: 'standard-generation',
  capabilities: {
    toolbar: true,
    promptInput: false,
    toolbarGenerate: true,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: { fromSource: true, fromTarget: false },
    targetHandleMode: 'rows',
  },
  media: { kind: 'image', role: 'generator' },
  ports: {
    source: { emits: 'image' },
    target: { accepts: ['image'] },
  },
  generation: {
    modelType: 'image',
    resultNodeType: CANVAS_NODE_TYPES.exportImage,
  },
  getOutputs: imageOutputsFromData,
  createDefaultData: createUpscaleGenerationDefaultData,
};

function createPortraitTextureGenerationDefaultData(): PortraitTextureGenerationNodeData {
  const settings = { ...DEFAULT_PORTRAIT_TEXTURE_SETTINGS };
  const route = preparePortraitTextureRoute(
    settings,
    registry.getModelsByType('image'),
    PORTRAIT_TEXTURE_DEFAULT_MODEL_ID,
  );
  return {
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.portraitTextureGen],
    imageUrl: null,
    previewImageUrl: null,
    aspectRatio: DEFAULT_ASPECT_RATIO,
    isSizeManuallyAdjusted: false,
    prompt: route.prompt,
    modelId: route.model?.meta.id ?? PORTRAIT_TEXTURE_DEFAULT_MODEL_ID,
    params: route.params,
    mediaInputs: {},
    isGenerating: false,
    generationStartedAt: null,
    generationDurationMs: undefined,
    capabilityId: CANVAS_IMAGE_CAPABILITY_IDS.portraitTexture,
    promptTemplateVersion: PORTRAIT_TEXTURE_TEMPLATE_VERSION,
    fixedSemanticParams: { portraitTextureContractVersion: 1 },
    portraitTextureSettings: settings as unknown as DynamicValueMap,
    portraitTextureRouteReasons: route.reasons,
  };
}

export const portraitTextureGenerationNodeDefinition: CanvasNodeDefinition<PortraitTextureGenerationNodeData> = {
  type: CANVAS_NODE_TYPES.portraitTextureGen,
  menuLabelKey: 'node.menu.portraitTextureGeneration',
  menuIcon: 'imageGeneration',
  visibleInMenu: false,
  executionKind: 'standard-generation',
  capabilities: {
    toolbar: true,
    promptInput: false,
    toolbarGenerate: true,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: { fromSource: true, fromTarget: false },
    targetHandleMode: 'rows',
  },
  media: { kind: 'image', role: 'generator' },
  ports: {
    source: { emits: 'image' },
    target: { accepts: ['image'] },
  },
  generation: {
    modelType: 'image',
    resultNodeType: CANVAS_NODE_TYPES.exportImage,
  },
  getOutputs: imageOutputsFromData,
  createDefaultData: createPortraitTextureGenerationDefaultData,
};

function createElementEditGenerationDefaultData(): ElementEditGenerationNodeData {
  const candidates = resolveCanvasCapabilityModelCandidates(
    registry.getModelsByType('image'),
    ELEMENT_EDIT_MODEL_POLICY,
  ).candidates.map(({ model }) => model);
  const model = selectDefaultElementEditModel(candidates);
  const modelId = model?.meta.id ?? ELEMENT_EDIT_DEFAULT_MODEL_ID;
  const params = model
    ? mapCanvasCapabilityModelParams(model, ELEMENT_EDIT_MODEL_POLICY).params
    : {};
  return {
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.elementEditGen],
    imageUrl: null,
    previewImageUrl: null,
    aspectRatio: DEFAULT_ASPECT_RATIO,
    isSizeManuallyAdjusted: false,
    prompt: '',
    modelId,
    params,
    mediaInputs: {},
    isGenerating: false,
    generationStartedAt: null,
    generationDurationMs: undefined,
    capabilityId: CANVAS_IMAGE_CAPABILITY_IDS.elementEdit,
    promptTemplateVersion: ELEMENT_EDIT_PROMPT_TEMPLATE_VERSION,
    fixedSemanticParams: { ...ELEMENT_EDIT_FIXED_SEMANTIC_PARAMS },
    localRedrawMaskSource: null,
    localRedrawMaskDocument: null,
    localRedrawSettings: { ...DEFAULT_LOCAL_REDRAW_SETTINGS },
  };
}

export const elementEditGenerationNodeDefinition: CanvasNodeDefinition<ElementEditGenerationNodeData> = {
  type: CANVAS_NODE_TYPES.elementEditGen,
  menuLabelKey: 'node.menu.elementEditGeneration',
  menuIcon: 'imageGeneration',
  visibleInMenu: false,
  executionKind: 'standard-generation',
  capabilities: {
    toolbar: true,
    promptInput: false,
    toolbarGenerate: true,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: { fromSource: true, fromTarget: false },
    targetHandleMode: 'rows',
  },
  media: { kind: 'image', role: 'generator' },
  ports: {
    source: { emits: 'image' },
    target: { accepts: ['image'] },
  },
  generation: {
    modelType: 'image',
    resultNodeType: CANVAS_NODE_TYPES.exportImage,
  },
  getOutputs: imageOutputsFromData,
  createDefaultData: createElementEditGenerationDefaultData,
};

function createLayerSeparationGenerationDefaultData(): LayerSeparationGenerationNodeData {
  const candidates = resolveCanvasCapabilityModelCandidates(
    registry.getModelsByType('image'),
    LAYER_SEPARATION_MODEL_POLICY,
  ).candidates.map(({ model }) => model);
  const model = selectDefaultLayerSeparationModel(candidates);
  return {
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.layerSeparationGen],
    imageUrl: null,
    previewImageUrl: null,
    aspectRatio: DEFAULT_ASPECT_RATIO,
    isSizeManuallyAdjusted: false,
    prompt: '',
    modelId: model?.meta.id ?? LAYER_SEPARATION_DEFAULT_MODEL_ID,
    params: model ? mapCanvasCapabilityModelParams(model, LAYER_SEPARATION_MODEL_POLICY).params : {},
    mediaInputs: {},
    isGenerating: false,
    generationStartedAt: null,
    generationDurationMs: undefined,
    capabilityId: CANVAS_IMAGE_CAPABILITY_IDS.layerSeparation,
    promptTemplateVersion: null,
    fixedSemanticParams: { layerStackContractVersion: LAYER_STACK_CONTRACT_VERSION },
  };
}

export const layerSeparationGenerationNodeDefinition: CanvasNodeDefinition<LayerSeparationGenerationNodeData> = {
  type: CANVAS_NODE_TYPES.layerSeparationGen,
  menuLabelKey: 'node.menu.layerSeparationGeneration',
  menuIcon: 'imageGeneration',
  visibleInMenu: false,
  executionKind: 'standard-generation',
  capabilities: { toolbar: true, promptInput: true, toolbarGenerate: true },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: { fromSource: true, fromTarget: false },
    targetHandleMode: 'rows',
  },
  media: { kind: 'image', role: 'generator' },
  ports: { source: { emits: 'image' }, target: { accepts: ['image'] } },
  generation: { modelType: 'image', resultNodeType: CANVAS_NODE_TYPES.layerStackResult },
  getOutputs: imageOutputsFromData,
  createDefaultData: createLayerSeparationGenerationDefaultData,
};

export const layerStackResultNodeDefinition: CanvasNodeDefinition<LayerStackResultNodeData> = {
  type: CANVAS_NODE_TYPES.layerStackResult,
  menuLabelKey: 'node.menu.layerStackResult',
  menuIcon: 'assetGroup',
  visibleInMenu: false,
  capabilities: { toolbar: true, promptInput: false, toolbarDownload: true },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: { fromSource: false, fromTarget: false },
    manualSource: true,
  },
  media: { kind: 'image', role: 'result' },
  ports: { source: { emits: 'image' }, target: { accepts: ['image'] } },
  getOutputs: imageOutputsFromData,
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.layerStackResult],
    imageUrl: null,
    previewImageUrl: null,
    aspectRatio: DEFAULT_ASPECT_RATIO,
    resultKind: 'layer-stack',
  }),
};
