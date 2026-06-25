import type { NodeTypes } from '@xyflow/react';

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

export const nodeTypes: NodeTypes = {
  exportImageNode: ImageNode,
  groupNode: GroupNode,
  imageNode: ImageEditNode,
  storyboardGenNode: StoryboardGenNode,
  storyboardNode: StoryboardNode,
  textAnnotationNode: TextAnnotationNode,
  uploadNode: UploadNode,
  videoGenNode: VideoGenNode,
  audioGenNode: AudioGenNode,
  exportVideoNode: VideoNode,
  exportAudioNode: AudioNode,
  videoUploadNode: VideoNode,
  audioUploadNode: AudioNode,
  intSourceNode: IntSourceNode,
  floatSourceNode: FloatSourceNode,
  stringSourceNode: StringSourceNode,
  booleanSourceNode: BooleanSourceNode,
  imageModelSelectorNode: ImageModelSelectorNode,
  videoModelSelectorNode: VideoModelSelectorNode,
  audioModelSelectorNode: AudioModelSelectorNode,
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
};
