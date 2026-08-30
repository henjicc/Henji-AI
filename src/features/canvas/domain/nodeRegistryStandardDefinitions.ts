import { DEFAULT_PPIO_MODEL_ID, DEFAULT_PPIO_PROVIDER_ID } from '@/core/llm/defaults';
import { CANVAS_BG_HEX, CANVAS_TEXT_HEX } from '@/core/theme/colorTokens';
import type { ModelTag } from '@/core/types';

import {
  CANVAS_NODE_TYPES,
  DEFAULT_ASPECT_RATIO,
  type AssetGroupNodeData,
  type CameraStageNodeData,
  type ExportImageNodeData,
  type GroupNodeData,
  type StoryboardGenNodeData,
  type StoryboardSplitNodeData,
  type TextAnnotationNodeData,
  type TextProcessingNodeData,
} from './canvasNodes';
import { getDefaultModelId } from './defaultModels';
import { DEFAULT_NODE_DISPLAY_NAME } from './nodeDisplay';
import { imageOutputsFromData } from './nodeRegistryMediaOutputs';
import type { CanvasNodeDefinition } from './nodeRegistryContracts';

export const exportImageNodeDefinition: CanvasNodeDefinition<ExportImageNodeData> = {
  type: CANVAS_NODE_TYPES.exportImage,
  menuLabelKey: 'node.menu.uploadImage',
  menuIcon: 'upload',
  visibleInMenu: false,
  capabilities: {
    toolbar: true,
    promptInput: false,
    toolbarDownload: true,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
    manualSource: true,
  },
  media: { kind: 'image', role: 'result' },
  ports: {
    source: { emits: 'image' },
    target: { accepts: ['image'] },
  },
  getOutputs: imageOutputsFromData,

  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.exportImage],
    imageUrl: null,
    previewImageUrl: null,
    aspectRatio: DEFAULT_ASPECT_RATIO,
    isSizeManuallyAdjusted: false,
    resultKind: 'generic',
  }),
};

export const groupNodeDefinition: CanvasNodeDefinition<GroupNodeData> = {
  type: CANVAS_NODE_TYPES.group,
  menuLabelKey: 'node.menu.storyboard',
  menuIcon: 'storyboard',
  visibleInMenu: false,
  capabilities: {
    toolbar: false,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: false,
    targetHandle: false,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.group],
    label: '组',
  }),
};

export const assetGroupNodeDefinition: CanvasNodeDefinition<AssetGroupNodeData> = {
  type: CANVAS_NODE_TYPES.assetGroup,
  menuLabelKey: 'node.menu.assetGroup',
  menuIcon: 'assetGroup',
  visibleInMenu: false,
  capabilities: { toolbar: true, promptInput: false },
  connectivity: {
    sourceHandle: true,
    targetHandle: false,
    connectMenu: { fromSource: false, fromTarget: false },
    manualSource: true,
  },
  // 实际媒体类型由组成员展开，组端口只负责启动绑定手势，不能作为普通媒体边使用。
  ports: { source: { emits: 'image' } },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.assetGroup],
    memberOrder: [],
    coverMemberId: null,
    bindings: [],
  }),
};

export const textAnnotationNodeDefinition: CanvasNodeDefinition<TextAnnotationNodeData> = {
  type: CANVAS_NODE_TYPES.textAnnotation,
  menuLabelKey: 'node.menu.textAnnotation',
  menuIcon: 'textAnnotation',
  visibleInMenu: true,
  menuSection: 'textTools',
  menuOrder: 20,
  executionKind: 'text-display',
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: false,
      fromTarget: true,
    },
    manualSource: true,
  },
  ports: {
    source: { emits: 'text' },
    target: { accepts: ['text'] },
  },
  getValueOutput: (data) => ({
    socketType: 'STRING',
    value: (data as TextAnnotationNodeData).content,
  }),
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.textAnnotation],
    content: '',
    isGenerating: false,
    generationStartedAt: null,
    generationError: null,
  }),
};

export const textProcessingNodeDefinition: CanvasNodeDefinition<TextProcessingNodeData> = {
  type: CANVAS_NODE_TYPES.textProcessing,
  menuLabelKey: 'node.menu.textProcessing',
  menuIcon: 'textProcessing',
  visibleInMenu: true,
  menuSection: 'textTools',
  menuOrder: 10,
  executionKind: 'text-processing',
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
    manualSource: true,
    targetHandleMode: 'rows',
  },
  ports: {
    source: { emits: 'text' },
    target: { accepts: ['image', 'video', 'audio'] },
  },
  getValueOutput: (data) => ({
    socketType: 'STRING',
    value: (data as TextProcessingNodeData).lastOutput ?? '',
  }),
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.textProcessing],
    prompt: '',
    systemPrompt: '',
    mediaInputs: {},
    providerId: DEFAULT_PPIO_PROVIDER_ID,
    modelId: DEFAULT_PPIO_MODEL_ID,
    lastOutput: '',
    fixedResult: true,
    lastOutputFingerprint: undefined,
    lastOutputRevision: 0,
    lastExecutionStatus: undefined,
  }),
};

export const cameraStageNodeDefinition: CanvasNodeDefinition<CameraStageNodeData> = {
  type: CANVAS_NODE_TYPES.cameraStage,
  menuLabelKey: 'node.menu.cameraStage',
  menuIcon: 'cameraStage',
  visibleInMenu: true,
  menuSection: 'textTools',
  menuOrder: 30,
  capabilities: { toolbar: true, promptInput: false },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: { fromSource: false, fromTarget: true },
    manualSource: false,
    targetHandleMode: 'rows',
  },
  ports: { source: { emits: 'image' }, target: { accepts: ['image'] } },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.cameraStage],
    projectId: null,
    imageUrl: null,
    previewImageUrl: null,
    videoUrl: null,
    aspectRatio: '16:9',
    durationSec: null,
    selectedTimeSec: 0,
    mediaInputs: {},
    environmentImageUrl: null,
    imageExporting: false,
    imageRenderRequestId: null,
    imageRenderError: null,
    videoProgress: null,
    videoExporting: false,
    videoRenderPhase: null,
    videoRenderRequestId: null,
    assetCollectionEnabled: false,
    assetCollectionLibraryId: null,
    videoRenderError: null,
    outputKind: 'image',
  }),
};

export const storyboardSplitDefinition: CanvasNodeDefinition<StoryboardSplitNodeData> = {
  type: CANVAS_NODE_TYPES.storyboardSplit,
  menuLabelKey: 'node.menu.storyboard',
  menuIcon: 'storyboard',
  visibleInMenu: false,
  capabilities: {
    toolbar: false,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
    targetHandleMode: 'rows',
  },
  media: { kind: 'image', role: 'result' },
  ports: {
    source: { emits: 'image' },
    target: { accepts: ['image'] },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.storyboardSplit],
    aspectRatio: DEFAULT_ASPECT_RATIO,
    frameAspectRatio: DEFAULT_ASPECT_RATIO,
    gridRows: 2,
    gridCols: 2,
    frames: [],
    exportOptions: {
      showFrameIndex: false,
      showFrameNote: false,
      notePlacement: 'overlay',
      imageFit: 'cover',
      frameIndexPrefix: 'S',
      cellGap: 8,
      outerPadding: 0,
      fontSize: 4,
      backgroundColor: CANVAS_BG_HEX,
      textColor: CANVAS_TEXT_HEX,
    },
  }),
};

/** 分镜生成始终向模型发送栅格参考图，因此默认模型也只能从支持图片编辑的模型中选取 */
const STORYBOARD_GEN_MODEL_REQUIRED_TAGS: ModelTag[] = ['image-to-image'];

export const storyboardGenNodeDefinition: CanvasNodeDefinition<StoryboardGenNodeData> = {
  type: CANVAS_NODE_TYPES.storyboardGen,
  menuLabelKey: 'node.menu.storyboardGen',
  menuIcon: 'storyboard',
  visibleInMenu: true,
  menuSection: 'media',
  menuOrder: 50,
  executionKind: 'storyboard-generation',
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
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.storyboardGen],
    gridRows: 2,
    gridCols: 2,
    frames: [],
    modelId: getDefaultModelId('image', STORYBOARD_GEN_MODEL_REQUIRED_TAGS),
    params: {},
    mediaInputs: {},
    imageUrl: null,
    previewImageUrl: null,
    aspectRatio: DEFAULT_ASPECT_RATIO,
    isGenerating: false,
    generationStartedAt: null,
    generationDurationMs: undefined,
  }),
};
