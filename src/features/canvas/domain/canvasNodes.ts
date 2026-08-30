import type { Edge, Node, XYPosition } from '@xyflow/react';

import type { CanvasNodeType } from './canvasNodeConstants';
import type {
  AssetGroupNodeData,
  AudioMediaNodeData,
  CameraStageNodeData,
  ElementEditGenerationNodeData,
  ExportImageNodeData,
  GroupNodeData,
  ImageEditNodeData,
  LayerSeparationGenerationNodeData,
  LayerStackResultNodeData,
  MediaGenNodeData,
  ModelSelectorNodeData,
  MultiAngleGenerationNodeData,
  PanoramaGenerationNodeData,
  PanoramaViewerNodeData,
  PortraitTextureGenerationNodeData,
  StoryboardFrameItem,
  StoryboardGenNodeData,
  StoryboardSplitNodeData,
  TextAnnotationNodeData,
  TextProcessingNodeData,
  UniversalUploadNodeData,
  UploadImageNodeData,
  UpscaleGenerationNodeData,
  ValueSourceNodeData,
  VideoMediaNodeData,
} from './canvasNodeData';

export * from './canvasNodeConstants';
export * from './canvasNodeData';
export * from './canvasNodeGuards';

export type CanvasNodeData =
  | UniversalUploadNodeData
  | UploadImageNodeData
  | ExportImageNodeData
  | TextProcessingNodeData
  | TextAnnotationNodeData
  | GroupNodeData
  | AssetGroupNodeData
  | ImageEditNodeData
  | PanoramaGenerationNodeData
  | PanoramaViewerNodeData
  | MultiAngleGenerationNodeData
  | UpscaleGenerationNodeData
  | PortraitTextureGenerationNodeData
  | ElementEditGenerationNodeData
  | LayerSeparationGenerationNodeData
  | LayerStackResultNodeData
  | StoryboardSplitNodeData
  | StoryboardGenNodeData
  | MediaGenNodeData
  | VideoMediaNodeData
  | CameraStageNodeData
  | AudioMediaNodeData
  | ValueSourceNodeData
  | ModelSelectorNodeData;

export type CanvasNode = Node<CanvasNodeData, CanvasNodeType>;

export interface CanvasEdgeData extends Record<string, unknown> {
  managedByAssetGroup?: {
    groupId: string;
    bindingId: string;
    memberId: string;
  };
  assetGroupBundle?: {
    groupId: string;
    bindingId: string;
    targetNodeId: string;
    connected: number;
    pending: number;
    unsupported: number;
    excluded: number;
  };
}

export type CanvasEdge = Edge<CanvasEdgeData>;

export interface CanvasConnectionInput {
  source: string;
  target: string;
  sourceHandle: string;
  targetHandle: string;
  data?: CanvasEdgeData;
}

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
