import {
  CANVAS_NODE_TYPES,
  type CanvasNodeData,
  type CanvasNodeType,
  type ExportImageNodeResultKind,
} from './canvasNodes';

export const DEFAULT_NODE_DISPLAY_NAME: Record<CanvasNodeType, string> = {
  [CANVAS_NODE_TYPES.universalUpload]: '上传',
  [CANVAS_NODE_TYPES.upload]: '上传图片',
  [CANVAS_NODE_TYPES.imageEdit]: '图片生成',
  [CANVAS_NODE_TYPES.panoramaGen]: '720°全景',
  [CANVAS_NODE_TYPES.relightGen]: '图片打光',
  [CANVAS_NODE_TYPES.exportImage]: '结果图片',
  [CANVAS_NODE_TYPES.textProcessing]: '文本处理',
  [CANVAS_NODE_TYPES.textAnnotation]: '文本展示',
  [CANVAS_NODE_TYPES.group]: '分组',
  [CANVAS_NODE_TYPES.assetGroup]: '素材组',
  [CANVAS_NODE_TYPES.storyboardSplit]: '切割结果',
  [CANVAS_NODE_TYPES.storyboardGen]: '分镜生成',
  [CANVAS_NODE_TYPES.videoGen]: '视频生成',
  [CANVAS_NODE_TYPES.audioGen]: '音频生成',
  [CANVAS_NODE_TYPES.exportVideo]: '结果视频',
  [CANVAS_NODE_TYPES.exportAudio]: '结果音频',
  [CANVAS_NODE_TYPES.videoUpload]: '上传视频',
  [CANVAS_NODE_TYPES.audioUpload]: '上传音频',
  [CANVAS_NODE_TYPES.intSource]: '整数',
  [CANVAS_NODE_TYPES.floatSource]: '浮点数',
  [CANVAS_NODE_TYPES.stringSource]: '文本',
  [CANVAS_NODE_TYPES.booleanSource]: '开关',
  [CANVAS_NODE_TYPES.imageModelSelector]: '图片模型选择器',
  [CANVAS_NODE_TYPES.videoModelSelector]: '视频模型选择器',
  [CANVAS_NODE_TYPES.audioModelSelector]: '音频模型选择器',
  [CANVAS_NODE_TYPES.cameraStage]: '3D 镜头参考',
};

export const EXPORT_RESULT_DISPLAY_NAME: Record<ExportImageNodeResultKind, string> = {
  image: '结果图片',
  panorama: '720°全景',
  'image-group': '图片组',
  'layer-stack': '图层结果',
  generic: '结果图片',
  storyboardGenOutput: '分镜输出',
  storyboardSplitExport: '切割导出',
  storyboardFrameEdit: '分镜帧',
};

function resolveExportResultDefault(data: Partial<CanvasNodeData>): string {
  const resultKind = (data as { resultKind?: ExportImageNodeResultKind }).resultKind ?? 'generic';
  return EXPORT_RESULT_DISPLAY_NAME[resultKind];
}

export function getDefaultNodeDisplayName(type: CanvasNodeType, data: Partial<CanvasNodeData>): string {
  if (type === CANVAS_NODE_TYPES.exportImage) {
    return resolveExportResultDefault(data);
  }
  return DEFAULT_NODE_DISPLAY_NAME[type];
}

export function resolveNodeDisplayName(type: CanvasNodeType, data: Partial<CanvasNodeData>): string {
  const customTitle = typeof data.displayName === 'string' ? data.displayName.trim() : '';
  if (customTitle) {
    return customTitle;
  }

  if (type === CANVAS_NODE_TYPES.group) {
    const legacyLabel = typeof (data as { label?: string }).label === 'string'
      ? (data as { label?: string }).label?.trim()
      : '';
    if (legacyLabel) {
      return legacyLabel;
    }
  }

  return getDefaultNodeDisplayName(type, data);
}

export function isNodeUsingDefaultDisplayName(type: CanvasNodeType, data: Partial<CanvasNodeData>): boolean {
  const customTitle = typeof data.displayName === 'string' ? data.displayName.trim() : '';
  if (!customTitle) {
    return true;
  }
  return customTitle === getDefaultNodeDisplayName(type, data);
}
