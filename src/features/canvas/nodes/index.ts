import { MissingNode } from './MissingNode';
import { createElement, memo, type ReactNode } from 'react';
import { areNodeContentPropsEqual } from './shared/nodeContentProps';
import type { NodeTypes } from '@xyflow/react';

import {
  CanvasNodePaintFrame,
  type CanvasNodePaintFrameOptions,
} from '@/features/canvas/ui/CanvasNodePaintFrame';

import { CanvasNodeBody } from '@/features/canvas/presence/CanvasNodeBody';

import { AudioGenNode } from './AudioGenNode';
import { AudioNode } from './AudioNode';
import { GroupNode } from './GroupNode';
import { AssetGroupNode } from './AssetGroupNode';
import { ImageEditNode } from './ImageEditNode';
import { PanoramaGenerationNode } from './PanoramaGenerationNode';
import { PanoramaViewerNode } from './PanoramaViewerNode';
import { RelightGenerationNode } from './RelightGenerationNode';
import { MultiAngleGenerationNode } from './MultiAngleGenerationNode';
import { UpscaleGenerationNode } from './UpscaleGenerationNode';
import { ElementEditGenerationNode } from './ElementEditGenerationNode';
import { LayerSeparationGenerationNode } from './LayerSeparationGenerationNode';
import { LayerStackResultNode } from './LayerStackResultNode';
import { ImageNode } from './ImageNode';
import { StoryboardGenNode } from './StoryboardGenNode';
import { StoryboardNode } from './StoryboardNode';
import { TextAnnotationNode } from './TextAnnotationNode';
import { TextProcessingNode } from './TextProcessingNode';
import { UniversalUploadNode } from './UniversalUploadNode';
import { VideoGenNode } from './VideoGenNode';
import { CameraStageNode } from './CameraStageNode';
import { VideoNode } from './VideoNode';
import {
  BooleanSourceNode,
  FloatSourceNode,
  IntSourceNode,
  StringSourceNode,
} from './value/ValueSourceNodes';
import {
  AudioModelSelectorNode,
  ImageModelSelectorNode,
  VideoModelSelectorNode,
} from './value/ModelSelectorNodes';

type NodeRenderComponent<TProps extends object> = ((props: TProps) => ReactNode) & {
  displayName?: string;
  name?: string;
};

const CANVAS_NODE_PAINT_CONTAINMENT_ENABLED = true;

/** 节点组件统一经过两层包装：正文挂载闸门（远景时不挂正文）与绘制裁剪框。 */
function withNodePaintFrame<TProps extends object>(
  Component: NodeRenderComponent<TProps>,
  options?: CanvasNodePaintFrameOptions,
): NodeRenderComponent<TProps> {
  const framed = !(!CANVAS_NODE_PAINT_CONTAINMENT_ENABLED || options?.disabled);
  const WrappedNode: NodeRenderComponent<TProps> = (props) => {
    const { id, width, height } = props as { id?: unknown; width?: unknown; height?: unknown };
    const nodeId = typeof id === 'string' ? id : undefined;
    const renderBody = (size: { width: number | undefined; height: number | undefined }): ReactNode => {
      const body = createElement(Component, nodeId === undefined ? props : { ...props, ...size });
      return framed ? createElement(CanvasNodePaintFrame, { ...options, nodeId }, body) : body;
    };
    if (nodeId === undefined) return renderBody({ width: undefined, height: undefined });
    return createElement(CanvasNodeBody, {
      id: nodeId,
      width: typeof width === 'number' ? width : undefined,
      height: typeof height === 'number' ? height : undefined,
      render: renderBody,
    });
  };
  WrappedNode.displayName = `withNodePaintFrame(${Component.displayName ?? Component.name ?? 'Node'})`;
  return memo<TProps>(WrappedNode, areNodeContentPropsEqual);
}

export const nodeTypes: NodeTypes = {
  missingNode: withNodePaintFrame(MissingNode),
  universalUploadNode: withNodePaintFrame(UniversalUploadNode),
  exportImageNode: withNodePaintFrame(ImageNode),
  groupNode: withNodePaintFrame(GroupNode),
  assetGroupNode: withNodePaintFrame(AssetGroupNode),
  imageNode: withNodePaintFrame(ImageEditNode, { bottom: 60 }),
  panoramaGenNode: withNodePaintFrame(PanoramaGenerationNode, { bottom: 60 }),
  panoramaViewerNode: withNodePaintFrame(PanoramaViewerNode),
  relightGenNode: withNodePaintFrame(RelightGenerationNode, { bottom: 60 }),
  multiAngleGenNode: withNodePaintFrame(MultiAngleGenerationNode, { bottom: 60 }),
  upscaleGenNode: withNodePaintFrame(UpscaleGenerationNode, { bottom: 60 }),
  elementEditGenNode: withNodePaintFrame(ElementEditGenerationNode, { bottom: 60 }),
  layerSeparationGenNode: withNodePaintFrame(LayerSeparationGenerationNode, { bottom: 60 }),
  layerStackResultNode: withNodePaintFrame(LayerStackResultNode),
  storyboardGenNode: withNodePaintFrame(StoryboardGenNode, { bottom: 84 }),
  storyboardNode: withNodePaintFrame(StoryboardNode),
  textAnnotationNode: withNodePaintFrame(TextAnnotationNode),
  textProcessingNode: withNodePaintFrame(TextProcessingNode, { bottom: 60 }),
  uploadNode: withNodePaintFrame(UniversalUploadNode),
  videoGenNode: withNodePaintFrame(VideoGenNode),
  audioGenNode: withNodePaintFrame(AudioGenNode),
  exportVideoNode: withNodePaintFrame(VideoNode),
  exportAudioNode: withNodePaintFrame(AudioNode),
  videoUploadNode: withNodePaintFrame(UniversalUploadNode),
  audioUploadNode: withNodePaintFrame(UniversalUploadNode),
  intSourceNode: withNodePaintFrame(IntSourceNode),
  floatSourceNode: withNodePaintFrame(FloatSourceNode),
  stringSourceNode: withNodePaintFrame(StringSourceNode),
  booleanSourceNode: withNodePaintFrame(BooleanSourceNode),
  imageModelSelectorNode: withNodePaintFrame(ImageModelSelectorNode),
  videoModelSelectorNode: withNodePaintFrame(VideoModelSelectorNode),
  audioModelSelectorNode: withNodePaintFrame(AudioModelSelectorNode),
  cameraStageNode: withNodePaintFrame(CameraStageNode),
};

