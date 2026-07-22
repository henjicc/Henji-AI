import type { Edge, Node, XYPosition } from '@xyflow/react';
import type { PromptDocumentV1, PromptMediaBinding } from '@/core/inputs/promptDocument';
import type { RowMediaKind } from './socketTypes';

export const CANVAS_NODE_TYPES = {
  upload: 'uploadNode',
  imageEdit: 'imageNode',
  exportImage: 'exportImageNode',
  textAnnotation: 'textAnnotationNode',
  group: 'groupNode',
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

export interface NodeDisplayData {
  displayName?: string;
  [key: string]: DynamicValue;
}

/**
 * 结果节点的生成状态。
 * 占位节点在点击生成时就已建好（见 GenerationNodeShell），这组字段描述它此刻处于
 * 生成中 / 成功 / 失败的哪一态；失败原因写在这里而不是回挂到发起节点上。
 */
export interface NodeGenerationStatus {
  isGenerating?: boolean;
  generationStartedAt?: number | null;
  generationDurationMs?: number;
  /** 生成失败原因；有值时结果节点显示红色描边与错误内容 */
  generationError?: string | null;
  /**
   * 服务端异步任务 ID。异步任务一旦创建就写在这里并随项目持久化，
   * 应用重启后据此继续轮询（见 useCanvasResumePolling），出结果或明确失败前不丢任务。
   */
  serverTaskId?: string | null;
  /** 续查时需要用原模型发请求，与 serverTaskId 成对写入 */
  serverTaskModelId?: string | null;
}

export interface NodeImageData extends NodeDisplayData, NodeGenerationStatus {
  imageUrl: string | null;
  previewImageUrl?: string | null;
  aspectRatio: string;
  isSizeManuallyAdjusted?: boolean;
  [key: string]: DynamicValue;
}

export interface UploadImageNodeData extends NodeImageData {
  sourceFileName?: string | null;
}

export type ExportImageNodeResultKind =
  | 'generic'
  | 'storyboardGenOutput'
  | 'storyboardSplitExport'
  | 'storyboardFrameEdit';

export interface ExportImageNodeData extends NodeImageData {
  resultKind?: ExportImageNodeResultKind;
}

export interface GroupNodeData extends NodeDisplayData {
  label: string;
  [key: string]: DynamicValue;
}

export interface TextAnnotationNodeData extends NodeDisplayData {
  content: string;
  [key: string]: DynamicValue;
}

export interface ImageEditNodeData extends NodeImageData {
  prompt: string;
  promptDocument?: PromptDocumentV1;
  promptMediaBindings?: PromptMediaBinding[];
  mediaInputs?: Partial<Record<RowMediaKind, string[]>>;
  /** 核心 ModelRegistry 中的模型 ID */
  modelId?: string;
  /** schema 驱动的模型参数（与默认值合并后使用） */
  params?: DynamicValueMap;
  /** @deprecated 旧版字段，由 nodeMigrations 迁移到 modelId/params */
  model?: string;
  /** @deprecated 旧版字段 */
  size?: ImageSize;
  /** @deprecated 旧版字段 */
  requestAspectRatio?: string;
  /** @deprecated 旧版字段 */
  extraParams?: DynamicValueMap;
  isGenerating?: boolean;
  generationStartedAt?: number | null;
  generationDurationMs?: number;
}

export interface StoryboardFrameItem {
  id: string;
  imageUrl: string | null;
  previewImageUrl?: string | null;
  aspectRatio?: string;
  note: string;
  noteDocument?: PromptDocumentV1;
  order: number;
}

export interface StoryboardExportOptions {
  showFrameIndex: boolean;
  showFrameNote: boolean;
  notePlacement: 'overlay' | 'bottom';
  imageFit: 'cover' | 'contain';
  frameIndexPrefix: string;
  cellGap: number;
  outerPadding: number;
  fontSize: number;
  backgroundColor: string;
  textColor: string;
}

export interface StoryboardSplitNodeData {
  displayName?: string;
  aspectRatio: string;
  frameAspectRatio?: string;
  gridRows: number;
  gridCols: number;
  frames: StoryboardFrameItem[];
  exportOptions?: StoryboardExportOptions;
  [key: string]: DynamicValue;
}

export interface StoryboardGenFrameItem {
  id: string;
  description: string;
  descriptionDocument?: PromptDocumentV1;
  referenceIndex: number | null;
}

export interface StoryboardGenNodeData {
  displayName?: string;
  gridRows: number;
  gridCols: number;
  frames: StoryboardGenFrameItem[];
  /** 核心 ModelRegistry 中的模型 ID */
  modelId?: string;
  /** schema 驱动的模型参数（与默认值合并后使用） */
  params?: DynamicValueMap;
  /** 图片行未连线时的本地内联上传值 */
  mediaInputs?: Partial<Record<RowMediaKind, string[]>>;
  promptMediaBindings?: PromptMediaBinding[];
  /** @deprecated 旧版字段，由 nodeMigrations 迁移到 modelId/params */
  model?: string;
  /** @deprecated 旧版字段 */
  size?: ImageSize;
  /** @deprecated 旧版字段 */
  requestAspectRatio?: string;
  /** @deprecated 旧版字段 */
  extraParams?: DynamicValueMap;
  imageUrl: string | null;
  previewImageUrl?: string | null;
  aspectRatio: string;
  isGenerating?: boolean;
  generationStartedAt?: number | null;
  generationDurationMs?: number;
  [key: string]: DynamicValue;
}

export interface MediaGenNodeData extends NodeDisplayData {
  prompt: string;
  promptDocument?: PromptDocumentV1;
  promptMediaBindings?: PromptMediaBinding[];
  mediaInputs?: Partial<Record<RowMediaKind, string[]>>;
  videoTrimStart?: number;
  videoTrimEnd?: number;
  modelId?: string;
  params?: DynamicValueMap;
  isGenerating?: boolean;
  generationStartedAt?: number | null;
  generationDurationMs?: number;
  [key: string]: DynamicValue;
}

export type VideoGenNodeData = MediaGenNodeData;
export type AudioGenNodeData = MediaGenNodeData;

export interface VideoMediaNodeData extends NodeDisplayData, NodeGenerationStatus {
  videoUrl: string | null;
  /** 视频首帧 poster（本地路径），节点展示与缩略图共用 */
  previewImageUrl?: string | null;
  aspectRatio: string;
  durationSec?: number | null;
  sourceFileName?: string | null;
  isSizeManuallyAdjusted?: boolean;
  [key: string]: DynamicValue;
}

export interface CameraStageNodeData extends NodeDisplayData {
  projectId: string | null;
  imageUrl: string | null;
  previewImageUrl?: string | null;
  videoUrl: string | null;
  aspectRatio: string;
  durationSec: number | null;
  selectedTimeSec: number;
  videoProgress?: number | null;
  videoExporting?: boolean;
  videoRenderPhase?: 'preparing' | 'rendering' | 'encoding' | null;
  videoRenderRequestId?: string | null;
  videoRenderError?: string | null;
  assetCollectionEnabled?: boolean;
  assetCollectionLibraryId?: string | null;
  /** 场景时间轴决定的唯一可用输出类型；旧节点缺省按静态图片处理。 */
  outputKind?: 'image' | 'video';
}

export interface AudioMediaNodeData extends NodeDisplayData, NodeGenerationStatus {
  audioUrl: string | null;
  durationSec?: number | null;
  sourceFileName?: string | null;
  [key: string]: DynamicValue;
}

/**
 * 数值/源节点数据：单一标量值，通过 getValueOutput 喂给下游参数端口。
 * value 的具体类型（number/string/boolean）由节点类型对应的插槽类型决定。
 */
export interface ValueSourceNodeData extends NodeDisplayData {
  value: number | string | boolean;
}

/** 模型选择器节点数据：按媒体类型选定一个模型，输出 MODEL 值供下游节点的模型端口覆盖 */
export interface ModelSelectorNodeData extends NodeDisplayData {
  modelId: string;
  /** 展开态：节点本体直出搜索+筛选+模型列表；未设置（旧节点）按折叠态处理 */
  isExpanded?: boolean;
}

export type CanvasNodeData =
  | UploadImageNodeData
  | ExportImageNodeData
  | TextAnnotationNodeData
  | GroupNodeData
  | ImageEditNodeData
  | StoryboardSplitNodeData
  | StoryboardGenNodeData
  | MediaGenNodeData
  | VideoMediaNodeData
  | CameraStageNodeData
  | AudioMediaNodeData
  | ValueSourceNodeData
  | ModelSelectorNodeData;

export type CanvasNode = Node<CanvasNodeData, CanvasNodeType>;
export type CanvasEdge = Edge;

export interface NodeCreationDto {
  type: CanvasNodeType;
  position: XYPosition;
  data?: Partial<CanvasNodeData>;
}

export interface StoryboardNodeCreationDto {
  position: XYPosition;
  rows: number;
  cols: number;
  frames: StoryboardFrameItem[];
}

export const NODE_TOOL_TYPES = {
  edit: 'edit',
  splitStoryboard: 'split-storyboard',
} as const;

export type NodeToolType = (typeof NODE_TOOL_TYPES)[keyof typeof NODE_TOOL_TYPES];

export interface ActiveToolDialog {
  nodeId: string;
  toolType: NodeToolType;
}

export function isUploadNode(
  node: CanvasNode | null | undefined
): node is Node<UploadImageNodeData, typeof CANVAS_NODE_TYPES.upload> {
  return node?.type === CANVAS_NODE_TYPES.upload;
}

export function isImageEditNode(
  node: CanvasNode | null | undefined
): node is Node<ImageEditNodeData, typeof CANVAS_NODE_TYPES.imageEdit> {
  return node?.type === CANVAS_NODE_TYPES.imageEdit;
}

export function isExportImageNode(
  node: CanvasNode | null | undefined
): node is Node<ExportImageNodeData, typeof CANVAS_NODE_TYPES.exportImage> {
  return node?.type === CANVAS_NODE_TYPES.exportImage;
}

export function isGroupNode(
  node: CanvasNode | null | undefined
): node is Node<GroupNodeData, typeof CANVAS_NODE_TYPES.group> {
  return node?.type === CANVAS_NODE_TYPES.group;
}

export function isTextAnnotationNode(
  node: CanvasNode | null | undefined
): node is Node<TextAnnotationNodeData, typeof CANVAS_NODE_TYPES.textAnnotation> {
  return node?.type === CANVAS_NODE_TYPES.textAnnotation;
}

export function isStoryboardSplitNode(
  node: CanvasNode | null | undefined
): node is Node<StoryboardSplitNodeData, typeof CANVAS_NODE_TYPES.storyboardSplit> {
  return node?.type === CANVAS_NODE_TYPES.storyboardSplit;
}

export function isStoryboardGenNode(
  node: CanvasNode | null | undefined
): node is Node<StoryboardGenNodeData, typeof CANVAS_NODE_TYPES.storyboardGen> {
  return node?.type === CANVAS_NODE_TYPES.storyboardGen;
}

export function isVideoMediaNode(
  node: CanvasNode | null | undefined
): node is Node<VideoMediaNodeData, typeof CANVAS_NODE_TYPES.exportVideo | typeof CANVAS_NODE_TYPES.videoUpload> {
  return node?.type === CANVAS_NODE_TYPES.exportVideo || node?.type === CANVAS_NODE_TYPES.videoUpload;
}

export function isAudioMediaNode(
  node: CanvasNode | null | undefined
): node is Node<AudioMediaNodeData, typeof CANVAS_NODE_TYPES.exportAudio | typeof CANVAS_NODE_TYPES.audioUpload> {
  return node?.type === CANVAS_NODE_TYPES.exportAudio || node?.type === CANVAS_NODE_TYPES.audioUpload;
}

export function isCameraStageNode(
  node: CanvasNode | null | undefined,
): node is Node<CameraStageNodeData, typeof CANVAS_NODE_TYPES.cameraStage> {
  return node?.type === CANVAS_NODE_TYPES.cameraStage;
}

export function isValueSourceNodeType(type: CanvasNodeType | string | undefined | null): boolean {
  return (VALUE_SOURCE_NODE_TYPES as readonly string[]).includes(type as string);
}

export function nodeHasImage(node: CanvasNode | null | undefined): boolean {
  if (!node) {
    return false;
  }

  if (isUploadNode(node) || isImageEditNode(node) || isExportImageNode(node)) {
    return Boolean(node.data.imageUrl);
  }

  if (isStoryboardSplitNode(node)) {
    return node.data.frames.some((frame) => Boolean(frame.imageUrl));
  }

  if (isStoryboardGenNode(node)) {
    return Boolean(node.data.imageUrl);
  }

  return false;
}
