import { createPlainTextPromptDocument } from '@/core/inputs/promptDocument';
import { registry } from '@/core/ModelRegistry';

import { CANVAS_IMAGE_CAPABILITY_IDS } from '../capabilities/types';
import {
  mapCanvasCapabilityModelParams,
  resolveCanvasCapabilityModelCandidates,
} from '../capabilities/modelCompatibility';
import {
  PANORAMA_MODEL_POLICY,
  PANORAMA_PROMPT_POLICY,
  PANORAMA_DEFAULT_PROMPT,
  PANORAMA_DEFAULT_PROMPT_VERSION,
  PANORAMA_TEXT_TEMPLATE_VERSION,
} from '../capabilities/panoramaPolicy';
import {
  CANVAS_NODE_TYPES,
  DEFAULT_ASPECT_RATIO,
  type ImageEditNodeData,
  type PanoramaGenerationNodeData,
  type PanoramaViewerNodeData,
  type UniversalUploadNodeData,
  type UploadImageNodeData,
} from './canvasNodes';
import { getDefaultModelId } from './defaultModels';
import { DEFAULT_NODE_DISPLAY_NAME } from './nodeDisplay';
import { imageOutputsFromData } from './nodeRegistryMediaOutputs';
import type { CanvasNodeDefinition } from './nodeRegistryContracts';
import { mediaSourcePortId } from './nodePorts';
import {
  PANORAMA_DEFAULT_CAMERA_VIEW,
  PANORAMA_DEFAULT_VIEW_MODE,
  PANORAMA_DEFAULT_VIEWPORT_ASPECT_RATIO,
} from './panoramaViewer';

export const universalUploadNodeDefinition: CanvasNodeDefinition<UniversalUploadNodeData> = {
  type: CANVAS_NODE_TYPES.universalUpload,
  menuLabelKey: 'node.menu.upload',
  menuIcon: 'upload',
  visibleInMenu: true,
  menuSection: 'media',
  menuOrder: 10,
  menuAggregationKey: 'upload',
  menuBehavior: 'chooseMediaBeforeCreate',
  executionBoundary: 'media',
  capabilities: { toolbar: true, promptInput: false },
  connectivity: {
    sourceHandle: true,
    targetHandle: false,
    connectMenu: { fromSource: false, fromTarget: false },
    manualSource: true,
    lockSourceMediaOnFirstConnection: true,
  },
  ports: {
    source: {
      emits: 'image',
      handles: {
        [mediaSourcePortId('image')]: 'image',
        [mediaSourcePortId('video')]: 'video',
        [mediaSourcePortId('audio')]: 'audio',
      },
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.universalUpload],
    lockedMediaKind: null,
    uploadError: null,
  }),
};

export const uploadNodeDefinition: CanvasNodeDefinition<UploadImageNodeData> = {
  type: CANVAS_NODE_TYPES.upload,
  menuLabelKey: 'node.menu.uploadImage',
  menuIcon: 'imageUpload',
  visibleInMenu: false,
  menuSection: 'media',
  menuOrder: 10,
  menuAggregationKey: 'upload',
  capabilities: {
    toolbar: true,
    promptInput: false,
    toolbarDownload: true,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: false,
    connectMenu: {
      fromSource: false,
      fromTarget: true,
    },
    manualSource: true,
  },
  media: { kind: 'image', role: 'source' },
  ports: {
    source: { emits: 'image' },
  },
  getOutputs: imageOutputsFromData,

  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.upload],
    imageUrl: null,
    previewImageUrl: null,
    aspectRatio: '1:1',
    isSizeManuallyAdjusted: false,
    sourceFileName: null,
  }),
};

export const imageEditNodeDefinition: CanvasNodeDefinition<ImageEditNodeData> = {
  type: CANVAS_NODE_TYPES.imageEdit,
  menuLabelKey: 'node.menu.aiImageGeneration',
  menuIcon: 'imageGeneration',
  visibleInMenu: true,
  menuSection: 'media',
  menuOrder: 20,
  executionKind: 'standard-generation',
  capabilities: {
    toolbar: true,
    promptInput: false,
    toolbarGenerate: true,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: true,
      fromTarget: false,
    },
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

  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.imageEdit],
    imageUrl: null,
    previewImageUrl: null,
    aspectRatio: DEFAULT_ASPECT_RATIO,
    isSizeManuallyAdjusted: false,
    prompt: '',
    modelId: getDefaultModelId('image'),
    params: {},
    isGenerating: false,
    generationStartedAt: null,
    generationDurationMs: undefined,
  }),
};

export const panoramaViewerNodeDefinition: CanvasNodeDefinition<PanoramaViewerNodeData> = {
  type: CANVAS_NODE_TYPES.panoramaViewer,
  menuLabelKey: 'node.menu.panoramaViewer',
  menuIcon: 'panorama',
  visibleInMenu: true,
  menuSection: 'media',
  menuOrder: 60,
  capabilities: {
    toolbar: true,
    promptInput: false,
    toolbarDownload: true,
    toolbarImageCapabilities: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: { fromSource: false, fromTarget: false },
    manualSource: true,
    targetHandleMode: 'legacy',
  },
  media: { kind: 'image', role: 'result' },
  ports: { source: { emits: 'image' }, target: { accepts: ['image'] } },
  getOutputs: imageOutputsFromData,
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.panoramaViewer],
    imageUrl: null,
    previewImageUrl: null,
    aspectRatio: '2:1',
    isSizeManuallyAdjusted: false,
    resultKind: 'panorama',
    panoramaProjectionMode: 'strict-2:1',
    panoramaPreviewImageUrl: null,
    viewMode: PANORAMA_DEFAULT_VIEW_MODE,
    viewportAspectRatio: PANORAMA_DEFAULT_VIEWPORT_ASPECT_RATIO,
    cameraView: { ...PANORAMA_DEFAULT_CAMERA_VIEW },
  }),
};

function createPanoramaGenerationDefaultData(): PanoramaGenerationNodeData {
  const compatibleModels = resolveCanvasCapabilityModelCandidates(
    registry.getModelsByType('image'),
    PANORAMA_MODEL_POLICY,
  ).candidates;
  const modelId = compatibleModels[0]?.model.meta.id ?? getDefaultModelId('image');
  const model = registry.getModel(modelId);
  const params = model
    ? mapCanvasCapabilityModelParams(model, PANORAMA_MODEL_POLICY).params
    : {};
  return {
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.panoramaGen],
    imageUrl: null,
    previewImageUrl: null,
    aspectRatio: '2:1',
    isSizeManuallyAdjusted: false,
    prompt: PANORAMA_DEFAULT_PROMPT,
    promptDocument: createPlainTextPromptDocument(PANORAMA_DEFAULT_PROMPT),
    modelId,
    params,
    mediaInputs: {},
    isGenerating: false,
    generationStartedAt: null,
    generationDurationMs: undefined,
    capabilityId: CANVAS_IMAGE_CAPABILITY_IDS.panorama,
    promptTemplateVersion: PANORAMA_TEXT_TEMPLATE_VERSION,
    defaultPromptVersion: PANORAMA_DEFAULT_PROMPT_VERSION,
    fixedSemanticParams: { ...PANORAMA_PROMPT_POLICY.fixedSemanticParams },
  };
}

export const panoramaGenerationNodeDefinition: CanvasNodeDefinition<PanoramaGenerationNodeData> = {
  type: CANVAS_NODE_TYPES.panoramaGen,
  menuLabelKey: 'node.menu.panoramaGeneration',
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
    connectMenu: {
      fromSource: true,
      fromTarget: false,
    },
    targetHandleMode: 'rows',
  },
  media: { kind: 'image', role: 'generator' },
  ports: {
    source: { emits: 'image' },
    target: { accepts: ['image'] },
  },
  generation: {
    modelType: 'image',
    resultNodeType: CANVAS_NODE_TYPES.panoramaViewer,
  },
  getOutputs: imageOutputsFromData,
  createDefaultData: createPanoramaGenerationDefaultData,
};
