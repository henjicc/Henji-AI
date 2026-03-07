import {
  CANVAS_NODE_TYPES,
  type CanvasFlowEdge,
  type CanvasFlowNode,
  type ExportImageNodeData,
  type ImageEditNodeData,
  type StoryboardSplitNodeData,
  type UploadImageNodeData,
} from '@/workspaces/canvas/types'

export interface IncomingMedia {
  images: string[]
  imagePaths: string[]
  videos: string[]
  videoPaths: string[]
}

export function collectIncomingMedia(
  targetNodeId: string,
  nodes: CanvasFlowNode[],
  edges: CanvasFlowEdge[]
): IncomingMedia {
  const media: IncomingMedia = { images: [], imagePaths: [], videos: [], videoPaths: [] }
  const incoming = edges.filter((edge) => edge.target === targetNodeId)
  const nodeMap = new Map(nodes.map((node) => [node.id, node]))
  const seen = new Set<string>()

  const push = (type: 'image' | 'video', url?: string | null, filePath?: string): void => {
    if (!url) return
    const key = `${type}|${url}|${filePath ?? ''}`
    if (seen.has(key)) return
    seen.add(key)
    if (type === 'image') {
      media.images.push(url)
      media.imagePaths.push(filePath ?? '')
      return
    }
    media.videos.push(url)
    media.videoPaths.push(filePath ?? '')
  }

  incoming.forEach((edge) => {
    const source = nodeMap.get(edge.source)
    if (!source) return

    if (source.type === CANVAS_NODE_TYPES.upload) {
      const data = source.data as UploadImageNodeData
      push('image', data.imageUrl, data.filePath)
      return
    }

    if (source.type === CANVAS_NODE_TYPES.imageEdit) {
      const data = source.data as ImageEditNodeData
      push('image', data.imageUrl, data.filePath)
      return
    }

    if (source.type === CANVAS_NODE_TYPES.exportImage) {
      const data = source.data as ExportImageNodeData
      if (data.mediaType === 'image') push('image', data.imageUrl, data.filePath)
      if (data.mediaType === 'video') push('video', data.imageUrl, data.filePath)
      return
    }

    if (source.type === CANVAS_NODE_TYPES.storyboardSplit) {
      const data = source.data as StoryboardSplitNodeData
      data.frames.forEach((frame) => push('image', frame.imageUrl, frame.filePath))
    }
  })

  return media
}
