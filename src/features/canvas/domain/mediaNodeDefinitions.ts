import {
  CANVAS_NODE_TYPES,
  DEFAULT_ASPECT_RATIO,
  type AudioMediaNodeData,
  type CanvasNodeData,
  type MediaGenNodeData,
  type VideoMediaNodeData,
} from './canvasNodes';
import { DEFAULT_NODE_DISPLAY_NAME } from './nodeDisplay';
import { getDefaultModelId } from './defaultModels';
import type { NodeMediaOutput } from './nodePorts';
import type { CanvasNodeDefinition } from './nodeRegistry';

/** 视频/音频节点定义（与 nodeRegistry 中的图片系节点遵循同一 SOP） */

function videoOutputsFromData(data: CanvasNodeData): NodeMediaOutput[] {
  const videoUrl = (data as { videoUrl?: DynamicValue }).videoUrl;
  if (typeof videoUrl !== 'string' || !videoUrl) {
    return [];
  }
  const previewImageUrl = (data as { previewImageUrl?: DynamicValue }).previewImageUrl;
  return [{
    kind: 'video',
    url: videoUrl,
    previewUrl: typeof previewImageUrl === 'string' ? previewImageUrl : null,
  }];
}

function audioOutputsFromData(data: CanvasNodeData): NodeMediaOutput[] {
  const audioUrl = (data as { audioUrl?: DynamicValue }).audioUrl;
  if (typeof audioUrl !== 'string' || !audioUrl) {
    return [];
  }
  return [{ kind: 'audio', url: audioUrl }];
}

function createMediaGenDefaultData(
  type: typeof CANVAS_NODE_TYPES.videoGen | typeof CANVAS_NODE_TYPES.audioGen,
  modelType: 'video' | 'audio'
): MediaGenNodeData {
  return {
    displayName: DEFAULT_NODE_DISPLAY_NAME[type],
    prompt: '',
    modelId: getDefaultModelId(modelType),
    params: {},
    isGenerating: false,
    generationStartedAt: null,
    generationDurationMs: undefined,
  };
}

export const videoGenNodeDefinition: CanvasNodeDefinition<MediaGenNodeData> = {
  type: CANVAS_NODE_TYPES.videoGen,
  menuLabelKey: 'node.menu.videoGen',
  menuIcon: 'video',
  visibleInMenu: true,
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
  media: { kind: 'video', role: 'generator' },
  ports: {
    source: { emits: 'video' },
    // 上游图片作为首帧/参考图，上游视频作为视频输入（由模型自行消费）
    target: { accepts: ['image', 'video'] },
  },
  generation: {
    modelType: 'video',
    resultNodeType: CANVAS_NODE_TYPES.exportVideo,
  },
  createDefaultData: () => createMediaGenDefaultData(CANVAS_NODE_TYPES.videoGen, 'video'),
};

export const audioGenNodeDefinition: CanvasNodeDefinition<MediaGenNodeData> = {
  type: CANVAS_NODE_TYPES.audioGen,
  menuLabelKey: 'node.menu.audioGen',
  menuIcon: 'audio',
  visibleInMenu: true,
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
  media: { kind: 'audio', role: 'generator' },
  ports: {
    source: { emits: 'audio' },
    // 上游视频用于配音/配乐场景，上游音频作为参考
    target: { accepts: ['video', 'audio'] },
  },
  generation: {
    modelType: 'audio',
    resultNodeType: CANVAS_NODE_TYPES.exportAudio,
  },
  createDefaultData: () => createMediaGenDefaultData(CANVAS_NODE_TYPES.audioGen, 'audio'),
};

export const exportVideoNodeDefinition: CanvasNodeDefinition<VideoMediaNodeData> = {
  type: CANVAS_NODE_TYPES.exportVideo,
  menuLabelKey: 'node.menu.videoGen',
  menuIcon: 'video',
  visibleInMenu: false,
  capabilities: {
    toolbar: true,
    promptInput: false,
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
  media: { kind: 'video', role: 'result' },
  ports: {
    source: { emits: 'video' },
    target: { accepts: ['video'] },
  },
  getOutputs: videoOutputsFromData,
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.exportVideo],
    videoUrl: null,
    previewImageUrl: null,
    aspectRatio: DEFAULT_ASPECT_RATIO,
    durationSec: null,
    isSizeManuallyAdjusted: false,
    isGenerating: false,
    generationStartedAt: null,
    generationDurationMs: undefined,
  }),
};

export const exportAudioNodeDefinition: CanvasNodeDefinition<AudioMediaNodeData> = {
  type: CANVAS_NODE_TYPES.exportAudio,
  menuLabelKey: 'node.menu.audioGen',
  menuIcon: 'audio',
  visibleInMenu: false,
  capabilities: {
    toolbar: true,
    promptInput: false,
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
  media: { kind: 'audio', role: 'result' },
  ports: {
    source: { emits: 'audio' },
    target: { accepts: ['audio'] },
  },
  getOutputs: audioOutputsFromData,
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.exportAudio],
    audioUrl: null,
    durationSec: null,
    isGenerating: false,
    generationStartedAt: null,
    generationDurationMs: undefined,
  }),
};

export const videoUploadNodeDefinition: CanvasNodeDefinition<VideoMediaNodeData> = {
  type: CANVAS_NODE_TYPES.videoUpload,
  menuLabelKey: 'node.menu.uploadVideo',
  menuIcon: 'upload',
  visibleInMenu: true,
  capabilities: {
    toolbar: true,
    promptInput: false,
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
  media: { kind: 'video', role: 'source' },
  ports: {
    source: { emits: 'video' },
  },
  getOutputs: videoOutputsFromData,
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.videoUpload],
    videoUrl: null,
    previewImageUrl: null,
    aspectRatio: DEFAULT_ASPECT_RATIO,
    durationSec: null,
    sourceFileName: null,
    isSizeManuallyAdjusted: false,
  }),
};

export const audioUploadNodeDefinition: CanvasNodeDefinition<AudioMediaNodeData> = {
  type: CANVAS_NODE_TYPES.audioUpload,
  menuLabelKey: 'node.menu.uploadAudio',
  menuIcon: 'upload',
  visibleInMenu: true,
  capabilities: {
    toolbar: true,
    promptInput: false,
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
  media: { kind: 'audio', role: 'source' },
  ports: {
    source: { emits: 'audio' },
  },
  getOutputs: audioOutputsFromData,
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.audioUpload],
    audioUrl: null,
    durationSec: null,
    sourceFileName: null,
  }),
};
