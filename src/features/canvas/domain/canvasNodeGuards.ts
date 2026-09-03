import type { Node } from '@xyflow/react';

import {
  CANVAS_NODE_TYPES,
  VALUE_SOURCE_NODE_TYPES,
  type CanvasNodeType,
} from './canvasNodeConstants';
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
  MultiAngleGenerationNodeData,
  PanoramaGenerationNodeData,
  PanoramaViewerNodeData,
  PortraitTextureGenerationNodeData,
  StoryboardGenNodeData,
  StoryboardSplitNodeData,
  TextAnnotationNodeData,
  TextProcessingNodeData,
  UniversalUploadNodeData,
  UploadImageNodeData,
  UpscaleGenerationNodeData,
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

export function isPanoramaGenerationNode(
  node: CanvasNode | null | undefined
): node is Node<PanoramaGenerationNodeData, typeof CANVAS_NODE_TYPES.panoramaGen> {
  return node?.type === CANVAS_NODE_TYPES.panoramaGen;
}

export function isPanoramaViewerNode(
  node: CanvasNode | null | undefined
): node is Node<PanoramaViewerNodeData, typeof CANVAS_NODE_TYPES.panoramaViewer> {
  return node?.type === CANVAS_NODE_TYPES.panoramaViewer;
}

export function isUpscaleGenerationNode(
  node: CanvasNode | null | undefined
): node is Node<UpscaleGenerationNodeData, typeof CANVAS_NODE_TYPES.upscaleGen> {
  return node?.type === CANVAS_NODE_TYPES.upscaleGen;
}

export function isPortraitTextureGenerationNode(
  node: CanvasNode | null | undefined
): node is Node<PortraitTextureGenerationNodeData, typeof CANVAS_NODE_TYPES.portraitTextureGen> {
  return node?.type === CANVAS_NODE_TYPES.portraitTextureGen;
}

export function isElementEditGenerationNode(
  node: CanvasNode | null | undefined
): node is Node<ElementEditGenerationNodeData, typeof CANVAS_NODE_TYPES.elementEditGen> {
  return node?.type === CANVAS_NODE_TYPES.elementEditGen;
}

export function isLayerSeparationGenerationNode(
  node: CanvasNode | null | undefined
): node is Node<LayerSeparationGenerationNodeData, typeof CANVAS_NODE_TYPES.layerSeparationGen> {
  return node?.type === CANVAS_NODE_TYPES.layerSeparationGen;
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

export function isMultiAngleGenerationNode(
  node: CanvasNode | null | undefined
): node is Node<MultiAngleGenerationNodeData, typeof CANVAS_NODE_TYPES.multiAngleGen> {
  return node?.type === CANVAS_NODE_TYPES.multiAngleGen;
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

export function isUniversalUploadNode(
  node: CanvasNode | null | undefined
): node is Node<UniversalUploadNodeData, typeof CANVAS_NODE_TYPES.universalUpload> {
  return node?.type === CANVAS_NODE_TYPES.universalUpload;
}

export function isTextProcessingNode(
  node: CanvasNode | null | undefined
): node is Node<TextProcessingNodeData, typeof CANVAS_NODE_TYPES.textProcessing> {
  return node?.type === CANVAS_NODE_TYPES.textProcessing;
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
