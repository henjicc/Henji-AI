import type { Edge, Node, Viewport } from '@xyflow/react'

export const CANVAS_NODE_TYPES = {
  upload: 'uploadNode',
  imageEdit: 'imageNode',
  exportImage: 'exportImageNode',
  textAnnotation: 'textAnnotationNode',
  storyboardSplit: 'storyboardNode',
  storyboardGen: 'storyboardGenNode',
} as const

export type CanvasNodeType = (typeof CANVAS_NODE_TYPES)[keyof typeof CANVAS_NODE_TYPES]
export type MediaType = 'image' | 'video' | 'audio'
export type ImageSize = '0.5K' | '1K' | '2K' | '4K'

export interface UploadNodeCallbacks {
  onSelectFile?: (nodeId: string, file: File) => void
  onApplyUrl?: (nodeId: string, imageUrl: string) => void
  onOpenImage?: (imageUrl: string, filePath?: string) => void
}

export interface ImageEditNodeCallbacks {
  onChangeModel?: (nodeId: string, modelId: string) => void
  onChangePrompt?: (nodeId: string, prompt: string) => void
  onChangeParam?: (nodeId: string, key: string, value: unknown) => void
  onGenerate?: (nodeId: string) => void
  onOpenImage?: (imageUrl: string, filePath?: string) => void
}

export interface ExportImageNodeCallbacks {
  onOpenImage?: (imageUrl: string, filePath?: string) => void
  onOpenVideo?: (videoUrl: string, filePath?: string) => void
}

export interface TextAnnotationNodeCallbacks {
  onChangeText?: (nodeId: string, value: string) => void
}

export interface StoryboardGenFrameItem {
  id: string
  description: string
  referenceIndex: number | null
}

export interface StoryboardFrameItem {
  id: string
  imageUrl: string | null
  filePath?: string
  note: string
  order: number
}

export interface StoryboardGenNodeCallbacks {
  onChangeRows?: (nodeId: string, rows: number) => void
  onChangeCols?: (nodeId: string, cols: number) => void
  onChangeModel?: (nodeId: string, modelId: string) => void
  onChangeFrameDesc?: (nodeId: string, frameId: string, value: string) => void
  onGenerate?: (nodeId: string) => void
}

export interface StoryboardSplitNodeCallbacks {
  onChangeRows?: (nodeId: string, rows: number) => void
  onChangeCols?: (nodeId: string, cols: number) => void
  onSplitInput?: (nodeId: string) => void
  onChangeFrameNote?: (nodeId: string, frameId: string, value: string) => void
  onExport?: (nodeId: string) => void
  onOpenImage?: (imageUrl: string, filePath?: string) => void
}

export interface UploadImageNodeData extends UploadNodeCallbacks, Record<string, unknown> {
  displayName: string
  imageUrl: string | null
  filePath?: string
  aspectRatio: string
}

export interface ImageEditNodeData extends ImageEditNodeCallbacks, Record<string, unknown> {
  displayName: string
  imageUrl: string | null
  filePath?: string
  prompt: string
  model: string
  size: ImageSize
  requestAspectRatio: string
  params: Record<string, unknown>
  isGenerating: boolean
  progress: number
  error?: string
}

export type ExportImageNodeResultKind =
  | 'generic'
  | 'imageGenerateOutput'
  | 'storyboardSplitExport'
  | 'storyboardFrame'

export interface ExportImageNodeData extends ExportImageNodeCallbacks, Record<string, unknown> {
  displayName: string
  imageUrl: string | null
  filePath?: string
  mediaType: MediaType
  resultKind: ExportImageNodeResultKind
}

export interface TextAnnotationNodeData extends TextAnnotationNodeCallbacks, Record<string, unknown> {
  displayName: string
  content: string
}

export interface StoryboardGenNodeData extends StoryboardGenNodeCallbacks, Record<string, unknown> {
  displayName: string
  gridRows: number
  gridCols: number
  frames: StoryboardGenFrameItem[]
  model: string
  size: ImageSize
  requestAspectRatio: string
  extraParams: Record<string, unknown>
  isGenerating: boolean
  progress: number
  error?: string
}

export interface StoryboardSplitNodeData extends StoryboardSplitNodeCallbacks, Record<string, unknown> {
  displayName: string
  gridRows: number
  gridCols: number
  frames: StoryboardFrameItem[]
  frameAspectRatio: string
  isSplitting?: boolean
  error?: string
}

export type CanvasNodeData =
  | UploadImageNodeData
  | ImageEditNodeData
  | ExportImageNodeData
  | TextAnnotationNodeData
  | StoryboardGenNodeData
  | StoryboardSplitNodeData

export type CanvasFlowNode = Node<CanvasNodeData, CanvasNodeType>
export type CanvasFlowEdge = Edge

export interface CanvasFlowSnapshot {
  nodes: CanvasFlowNode[]
  edges: CanvasFlowEdge[]
  viewport: Viewport
}
