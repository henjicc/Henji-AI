import type { Node } from '@xyflow/react';

import {
  CANVAS_NODE_TYPES,
} from './canvasNodeConstants';
import type {
  AssetGroupNodeData,
  AudioMediaNodeData,
  CameraStageNodeData,
  ExportImageNodeData,
  GroupNodeData,
  ImageEditNodeData,
  LayerStackResultNodeData,
  StoryboardGenNodeData,
  StoryboardSplitNodeData,
  TextAnnotationNodeData,
  UploadImageNodeData,
  VideoMediaNodeData,
} from './canvasNodeData';
import type { CanvasNode } from './canvasNodes';
import { isEditableMultiLayerDocumentNode } from './multiLayerDocumentNode';

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

export function isLayerStackResultNode(
  node: CanvasNode | null | undefined
): node is Node<LayerStackResultNodeData, typeof CANVAS_NODE_TYPES.layerStackResult> {
  return node?.type === CANVAS_NODE_TYPES.layerStackResult;
}

export function isEditableLayerStackResultNode(
  node: CanvasNode | null | undefined
): node is Node<LayerStackResultNodeData, typeof CANVAS_NODE_TYPES.layerStackResult> {
  return isLayerStackResultNode(node) && isEditableMultiLayerDocumentNode(node.data);
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

export function isAssetGroupNode(
  node: CanvasNode | null | undefined
): node is Node<AssetGroupNodeData, typeof CANVAS_NODE_TYPES.assetGroup> {
  return node?.type === CANVAS_NODE_TYPES.assetGroup;
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

