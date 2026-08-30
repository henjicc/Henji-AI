export const CANVAS_NODE_TYPES = {
  universalUpload: 'universalUploadNode',
  upload: 'uploadNode',
  imageEdit: 'imageNode',
  panoramaGen: 'panoramaGenNode',
  panoramaViewer: 'panoramaViewerNode',
  relightGen: 'relightGenNode',
  multiAngleGen: 'multiAngleGenNode',
  upscaleGen: 'upscaleGenNode',
  portraitTextureGen: 'portraitTextureGenNode',
  elementEditGen: 'elementEditGenNode',
  layerSeparationGen: 'layerSeparationGenNode',
  layerStackResult: 'layerStackResultNode',
  exportImage: 'exportImageNode',
  textProcessing: 'textProcessingNode',
  textAnnotation: 'textAnnotationNode',
  group: 'groupNode',
  assetGroup: 'assetGroupNode',
  storyboardSplit: 'storyboardNode',
  storyboardGen: 'storyboardGenNode',
  videoGen: 'videoGenNode',
  audioGen: 'audioGenNode',
  exportVideo: 'exportVideoNode',
  exportAudio: 'exportAudioNode',
  videoUpload: 'videoUploadNode',
  audioUpload: 'audioUploadNode',
  intSource: 'intSourceNode',
  floatSource: 'floatSourceNode',
  stringSource: 'stringSourceNode',
  booleanSource: 'booleanSourceNode',
  imageModelSelector: 'imageModelSelectorNode',
  videoModelSelector: 'videoModelSelectorNode',
  audioModelSelector: 'audioModelSelectorNode',
  cameraStage: 'cameraStageNode',
} as const;

/** 数值/源节点类型集合（单一类型化输出，喂下游参数端口） */
export const VALUE_SOURCE_NODE_TYPES = [
  'intSourceNode',
  'floatSourceNode',
  'stringSourceNode',
  'booleanSourceNode',
] as const;

export type CanvasNodeType = (typeof CANVAS_NODE_TYPES)[keyof typeof CANVAS_NODE_TYPES];

export const DEFAULT_ASPECT_RATIO = '1:1';
export const AUTO_REQUEST_ASPECT_RATIO = 'auto';
export const DEFAULT_NODE_WIDTH = 220;
export const EXPORT_RESULT_NODE_DEFAULT_WIDTH = 384;
export const EXPORT_RESULT_NODE_LAYOUT_HEIGHT = 288;
export const EXPORT_RESULT_NODE_MIN_WIDTH = 168;
export const EXPORT_RESULT_NODE_MIN_HEIGHT = 168;

/** 模型选择器节点折叠态默认宽度（紧凑 chip 形态） */
export const MODEL_SELECTOR_COLLAPSED_DEFAULT_WIDTH = 240;
/**
 * 模型选择器节点折叠态默认高度：壳体 p-2（8px）上下内边距 + chip 本身高度（h-7，28px），
 * 折叠态正文固定只有一行 chip，按这个固定结构精确算出"刚好容纳内容"的最小高度，不留多余空白。
 */
export const MODEL_SELECTOR_COLLAPSED_DEFAULT_HEIGHT = 44;
/** 模型选择器节点展开态默认尺寸（搜索+筛选+列表内嵌正文），切换展开/折叠时据此自动调整节点尺寸 */
export const MODEL_SELECTOR_EXPANDED_DEFAULT_WIDTH = 320;
export const MODEL_SELECTOR_EXPANDED_DEFAULT_HEIGHT = 380;
export const MODEL_SELECTOR_EXPANDED_MIN_WIDTH = 280;
export const MODEL_SELECTOR_EXPANDED_MIN_HEIGHT = 320;
export const MODEL_SELECTOR_EXPANDED_MAX_WIDTH = 520;
export const MODEL_SELECTOR_EXPANDED_MAX_HEIGHT = 640;

export const IMAGE_SIZES = ['0.5K', '1K', '2K', '4K'] as const;
export const IMAGE_ASPECT_RATIOS = [
  '1:1',
  '16:9',
  '9:16',
  '4:3',
  '3:4',
  '21:9',
] as const;

export type ImageSize = (typeof IMAGE_SIZES)[number];
