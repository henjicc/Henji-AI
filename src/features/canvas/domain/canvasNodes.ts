import type { Edge, Node, XYPosition } from '@xyflow/react';

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

export interface NodeImageData extends NodeDisplayData {
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
  modelId?: string;
  params?: DynamicValueMap;
  isGenerating?: boolean;
  generationStartedAt?: number | null;
  generationDurationMs?: number;
  [key: string]: DynamicValue;
}

export type VideoGenNodeData = MediaGenNodeData;
export type AudioGenNodeData = MediaGenNodeData;

export interface VideoMediaNodeData extends NodeDisplayData {
  videoUrl: string | null;
  /** 视频首帧 poster（本地路径），节点展示与缩略图共用 */
  previewImageUrl?: string | null;
  aspectRatio: string;
  durationSec?: number | null;
  sourceFileName?: string | null;
  isSizeManuallyAdjusted?: boolean;
  isGenerating?: boolean;
  generationStartedAt?: number | null;
  generationDurationMs?: number;
  [key: string]: DynamicValue;
}

export interface AudioMediaNodeData extends NodeDisplayData {
  audioUrl: string | null;
  durationSec?: number | null;
  sourceFileName?: string | null;
  isGenerating?: boolean;
  generationStartedAt?: number | null;
  generationDurationMs?: number;
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
  crop: 'crop',
  annotate: 'annotate',
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
