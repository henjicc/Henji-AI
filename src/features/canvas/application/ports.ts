import type { XYPosition } from '@xyflow/react';

import type {
  CanvasNode,
  CanvasNodeData,
  CanvasNodeType,
  NodeToolType,
  StoryboardFrameItem,
} from '../domain/canvasNodes';
import type { CanvasNodeDefinition } from '../domain/nodeRegistry';
import type { ImageEditSessionReferenceV3 } from '@/core/imageEdit/v3/sessionReference';

export interface IdGenerator {
  next: () => string;
}

export interface NodeCatalog {
  getDefinition: (type: CanvasNodeType) => CanvasNodeDefinition;
  getMenuDefinitions: () => CanvasNodeDefinition[];
}

export interface NodeFactory {
  createNode: (
    type: CanvasNodeType,
    position: XYPosition,
    data?: Partial<CanvasNodeData>
  ) => CanvasNode;
}

export interface ImageSplitGateway {
  split: (
    imageSource: string,
    rows: number,
    cols: number,
    lineThickness: number
  ) => Promise<string[]>;
}

export interface ToolProcessorResult {
  outputImageUrl?: string;
  outputImageSize?: { width: number; height: number };
  /** 图片编辑 V3 的可恢复权威会话；只在受管输出完成后发布。 */
  imageEditSession?: ImageEditSessionReferenceV3;
  storyboardFrames?: StoryboardFrameItem[];
  rows?: number;
  cols?: number;
  frameAspectRatio?: string;
}

export interface ToolProcessor {
  process: (
    toolType: NodeToolType,
    sourceImageUrl: string,
    options: DynamicValueMap,
    signal?: AbortSignal,
  ) => Promise<ToolProcessorResult>;
}

export interface CanvasEventMap {
  'tool-dialog/open': {
    nodeId: string;
    toolType: NodeToolType;
  };
  'tool-dialog/close': undefined;
  'upload-node/reupload': {
    nodeId: string;
  };
  'upload-node/paste-image': {
    nodeId: string;
    file: File;
  };
  'canvas/import-media': {
    nodeId: string;
    file: File;
  };
  'camera-stage/open': {
    nodeId: string;
  };
  'camera-stage/output': {
    nodeId: string;
    kind: 'image' | 'video';
  };
  'camera-stage/render-image': {
    nodeId: string;
  };
  'camera-stage/render-video': {
    nodeId: string;
  };
  'canvas/toast': {
    message: string;
    type?: 'success' | 'error';
  };
  'asset-group/open': {
    groupId: string;
  };
}

export interface CanvasEventBus {
  publish: <TType extends keyof CanvasEventMap>(
    type: TType,
    payload: CanvasEventMap[TType]
  ) => void;
  subscribe: <TType extends keyof CanvasEventMap>(
    type: TType,
    handler: (payload: CanvasEventMap[TType]) => void
  ) => () => void;
}
