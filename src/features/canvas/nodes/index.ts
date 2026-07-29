import { createElement, type ReactNode } from 'react';
import type { NodeTypes } from '@xyflow/react';

import {
  CanvasNodePaintFrame,
  type CanvasNodePaintFrameOptions,
} from '@/features/canvas/ui/CanvasNodePaintFrame';

import { AudioGenNode } from './AudioGenNode';
import { AudioNode } from './AudioNode';
import { GroupNode } from './GroupNode';
import { ImageEditNode } from './ImageEditNode';
import { ImageNode } from './ImageNode';
import { StoryboardGenNode } from './StoryboardGenNode';
import { StoryboardNode } from './StoryboardNode';
import { TextAnnotationNode } from './TextAnnotationNode';
import { UploadNode } from './UploadNode';
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

export const CANVAS_NODE_PAINT_CONTAINMENT_ENABLED = true;

function withNodePaintFrame<TProps extends object>(
  Component: NodeRenderComponent<TProps>,
  options?: CanvasNodePaintFrameOptions,
): NodeRenderComponent<TProps> {
  if (!CANVAS_NODE_PAINT_CONTAINMENT_ENABLED || options?.disabled) {
    return Component;
  }
  const WrappedNode: NodeRenderComponent<TProps> = (props) => createElement(
    CanvasNodePaintFrame,
    options,
    createElement(Component, props),
  );
  WrappedNode.displayName = `withNodePaintFrame(${Component.displayName ?? Component.name ?? 'Node'})`;
  return WrappedNode;
}

export const nodeTypes: NodeTypes = {
  exportImageNode: withNodePaintFrame(ImageNode),
  groupNode: withNodePaintFrame(GroupNode),
  imageNode: withNodePaintFrame(ImageEditNode, { bottom: 60 }),
  storyboardGenNode: withNodePaintFrame(StoryboardGenNode, { bottom: 84 }),
  storyboardNode: withNodePaintFrame(StoryboardNode),
  textAnnotationNode: withNodePaintFrame(TextAnnotationNode),
  uploadNode: withNodePaintFrame(UploadNode),
  videoGenNode: withNodePaintFrame(VideoGenNode),
  audioGenNode: withNodePaintFrame(AudioGenNode),
  exportVideoNode: withNodePaintFrame(VideoNode),
  exportAudioNode: withNodePaintFrame(AudioNode),
  videoUploadNode: withNodePaintFrame(VideoNode),
  audioUploadNode: withNodePaintFrame(AudioNode),
  intSourceNode: withNodePaintFrame(IntSourceNode),
  floatSourceNode: withNodePaintFrame(FloatSourceNode),
  stringSourceNode: withNodePaintFrame(StringSourceNode),
  booleanSourceNode: withNodePaintFrame(BooleanSourceNode),
  imageModelSelectorNode: withNodePaintFrame(ImageModelSelectorNode),
  videoModelSelectorNode: withNodePaintFrame(VideoModelSelectorNode),
  audioModelSelectorNode: withNodePaintFrame(AudioModelSelectorNode),
  cameraStageNode: withNodePaintFrame(CameraStageNode),
};

export {
  AudioGenNode,
  AudioNode,
  GroupNode,
  ImageEditNode,
  ImageNode,
  StoryboardGenNode,
  StoryboardNode,
  TextAnnotationNode,
  UploadNode,
  VideoGenNode,
  VideoNode,
  IntSourceNode,
  FloatSourceNode,
  StringSourceNode,
  BooleanSourceNode,
  ImageModelSelectorNode,
  VideoModelSelectorNode,
  AudioModelSelectorNode,
  CameraStageNode,
};
