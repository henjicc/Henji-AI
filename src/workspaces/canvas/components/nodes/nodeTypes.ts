import type { NodeTypes } from '@xyflow/react'
import { UploadNode } from './UploadNode'
import { ImageEditNode } from './ImageEditNode'
import { ExportImageNode } from './ExportImageNode'
import { TextAnnotationNode } from './TextAnnotationNode'
import { StoryboardGenNode } from './StoryboardGenNode'
import { StoryboardSplitNode } from './StoryboardSplitNode'
import { CANVAS_NODE_TYPES } from '@/workspaces/canvas/types'

export const canvasNodeTypes: NodeTypes = {
  [CANVAS_NODE_TYPES.upload]: UploadNode,
  [CANVAS_NODE_TYPES.imageEdit]: ImageEditNode,
  [CANVAS_NODE_TYPES.exportImage]: ExportImageNode,
  [CANVAS_NODE_TYPES.textAnnotation]: TextAnnotationNode,
  [CANVAS_NODE_TYPES.storyboardGen]: StoryboardGenNode,
  [CANVAS_NODE_TYPES.storyboardSplit]: StoryboardSplitNode,
}
