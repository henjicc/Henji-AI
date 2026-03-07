import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type OnEdgesChange,
  type OnNodesChange,
  type Viewport,
} from '@xyflow/react'
import { registry } from '@/core/ModelRegistry'
import { createNode, createNodeId, DEFAULT_VIEWPORT } from '@/workspaces/canvas/flow/helpers'
import {
  createCanvasOperationContext,
  handleImageGenerateOperation,
  handleStoryboardExportOperation,
  handleStoryboardGenerateOperation,
  handleStoryboardSplitInputOperation,
  handleUploadSelectFileOperation,
} from '@/workspaces/canvas/flow/operations'
import { ensureStoryboardGenFrames, ensureStoryboardSplitFrames, normalizeCount } from '@/workspaces/canvas/flow/frameUtils'
import type { ActiveCanvasProject } from './useCanvasProjects'
import {
  CANVAS_NODE_TYPES,
  type CanvasFlowEdge,
  type CanvasFlowNode,
  type CanvasFlowSnapshot,
  type CanvasNodeData,
  type CanvasNodeType,
  type ExportImageNodeData,
  type ImageEditNodeData,
  type StoryboardGenNodeData,
  type StoryboardSplitNodeData,
  type UploadImageNodeData,
} from '@/workspaces/canvas/types'

type NodeUpdater = (prev: Record<string, unknown>) => Record<string, unknown>

export interface UseCanvasFlowEditorParams {
  project: ActiveCanvasProject
  onSnapshotChange: (snapshot: CanvasFlowSnapshot) => void
}

export interface UseCanvasFlowEditorReturn {
  nodes: CanvasFlowNode[]
  edges: CanvasFlowEdge[]
  viewNodes: CanvasFlowNode[]
  viewport: Viewport
  imageViewerUrl: string | null
  imageViewerPath?: string
  videoViewerUrl: string | null
  videoViewerPath?: string
  onNodesChange: OnNodesChange<CanvasFlowNode>
  onEdgesChange: OnEdgesChange<CanvasFlowEdge>
  onConnect: (connection: Connection) => void
  setViewport: (viewport: Viewport) => void
  addNodeByType: (type: CanvasNodeType) => void
  closeImageViewer: () => void
  closeVideoViewer: () => void
}

export function useCanvasFlowEditor({
  project,
  onSnapshotChange,
}: UseCanvasFlowEditorParams): UseCanvasFlowEditorReturn {
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasFlowNode>(project.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<CanvasFlowEdge>(project.edges)
  const [viewport, setViewportState] = useState<Viewport>(project.viewport ?? DEFAULT_VIEWPORT)

  const [imageViewerUrl, setImageViewerUrl] = useState<string | null>(null)
  const [imageViewerPath, setImageViewerPath] = useState<string | undefined>(undefined)
  const [videoViewerUrl, setVideoViewerUrl] = useState<string | null>(null)
  const [videoViewerPath, setVideoViewerPath] = useState<string | undefined>(undefined)

  const nodesRef = useRef<CanvasFlowNode[]>(nodes)
  const edgesRef = useRef<CanvasFlowEdge[]>(edges)
  const cursorRef = useRef(0)
  const hydratingRef = useRef(true)

  useEffect(() => {
    nodesRef.current = nodes
  }, [nodes])

  useEffect(() => {
    edgesRef.current = edges
  }, [edges])

  useEffect(() => {
    hydratingRef.current = true
    setNodes(project.nodes)
    setEdges(project.edges)
    setViewportState(project.viewport ?? DEFAULT_VIEWPORT)
    requestAnimationFrame(() => {
      hydratingRef.current = false
    })
  }, [project.id, project.nodes, project.edges, project.viewport, setEdges, setNodes])

  useEffect(() => {
    if (hydratingRef.current) return
    onSnapshotChange({ nodes, edges, viewport })
  }, [nodes, edges, viewport, onSnapshotChange])

  const setViewport = useCallback((nextViewport: Viewport) => {
    setViewportState(nextViewport)
  }, [])

  const nextPosition = useCallback(() => {
    cursorRef.current += 1
    const idx = cursorRef.current
    return { x: 120 + (idx % 4) * 380, y: 140 + Math.floor(idx / 4) * 260 }
  }, [])

  const updateNodeData = useCallback((nodeId: string, updater: NodeUpdater) => {
    setNodes((prev) =>
      prev.map((node) => {
        if (node.id !== nodeId) return node
        return { ...node, data: updater(node.data as Record<string, unknown>) as CanvasNodeData }
      })
    )
  }, [setNodes])

  const appendNode = useCallback((node: CanvasFlowNode) => {
    setNodes((prev) => [...prev, node])
  }, [setNodes])

  const addEdgeForNodes = useCallback((sourceId: string, targetId: string) => {
    setEdges((prev) => addEdge({ id: createNodeId('edge'), source: sourceId, target: targetId }, prev))
  }, [setEdges])

  const operationContext = useMemo(() => createCanvasOperationContext({
    getNodes: () => nodesRef.current,
    getEdges: () => edgesRef.current,
    updateNodeData,
    appendNode,
    connectNodes: addEdgeForNodes,
  }), [addEdgeForNodes, appendNode, updateNodeData])

  const openImageViewer = useCallback((imageUrl: string, filePath?: string) => {
    setImageViewerUrl(imageUrl)
    setImageViewerPath(filePath)
  }, [])

  const openVideoViewer = useCallback((videoUrl: string, filePath?: string) => {
    setVideoViewerUrl(videoUrl)
    setVideoViewerPath(filePath)
  }, [])

  const closeImageViewer = useCallback(() => {
    setImageViewerUrl(null)
    setImageViewerPath(undefined)
  }, [])

  const closeVideoViewer = useCallback(() => {
    setVideoViewerUrl(null)
    setVideoViewerPath(undefined)
  }, [])

  const addNodeByType = useCallback((type: CanvasNodeType) => {
    appendNode(createNode(type, nextPosition()))
  }, [appendNode, nextPosition])

  const handleUploadSelectFile = useCallback((nodeId: string, file: File) => {
    return handleUploadSelectFileOperation(operationContext, nodeId, file)
  }, [operationContext])

  const handleImageGenerate = useCallback((nodeId: string) => {
    return handleImageGenerateOperation(operationContext, nodeId)
  }, [operationContext])

  const handleStoryboardGenerate = useCallback((nodeId: string) => {
    return handleStoryboardGenerateOperation(operationContext, nodeId)
  }, [operationContext])

  const handleStoryboardSplitInput = useCallback((nodeId: string) => {
    return handleStoryboardSplitInputOperation(operationContext, nodeId)
  }, [operationContext])

  const handleStoryboardExport = useCallback((nodeId: string) => {
    return handleStoryboardExportOperation(operationContext, nodeId)
  }, [operationContext])

  const viewNodes = useMemo(() => nodes.map((node) => {
    if (node.type === CANVAS_NODE_TYPES.upload) {
      return {
        ...node,
        data: {
          ...(node.data as UploadImageNodeData),
          onSelectFile: handleUploadSelectFile,
          onApplyUrl: (nodeId: string, imageUrl: string) =>
            updateNodeData(nodeId, (prev) => ({ ...prev, imageUrl: imageUrl.trim(), filePath: '' })),
          onOpenImage: openImageViewer,
        },
      }
    }

    if (node.type === CANVAS_NODE_TYPES.imageEdit) {
      return {
        ...node,
        data: {
          ...(node.data as ImageEditNodeData),
          onChangeModel: (nodeId: string, modelId: string) =>
            updateNodeData(nodeId, (prev) => ({ ...prev, model: modelId, params: registry.getDefaultValues(modelId), error: '' })),
          onChangePrompt: (nodeId: string, prompt: string) => updateNodeData(nodeId, (prev) => ({ ...prev, prompt })),
          onChangeParam: (nodeId: string, key: string, value: unknown) =>
            updateNodeData(nodeId, (prev) => ({
              ...prev,
              params: {
                ...((prev as ImageEditNodeData).params ?? {}),
                [key]: value,
              },
            })),
          onGenerate: handleImageGenerate,
          onOpenImage: openImageViewer,
        },
      }
    }

    if (node.type === CANVAS_NODE_TYPES.exportImage) {
      return {
        ...node,
        data: {
          ...(node.data as ExportImageNodeData),
          onOpenImage: openImageViewer,
          onOpenVideo: openVideoViewer,
        },
      }
    }

    if (node.type === CANVAS_NODE_TYPES.textAnnotation) {
      return {
        ...node,
        data: {
          ...node.data,
          onChangeText: (nodeId: string, value: string) => updateNodeData(nodeId, (prev) => ({ ...prev, content: value })),
        },
      }
    }

    if (node.type === CANVAS_NODE_TYPES.storyboardGen) {
      return {
        ...node,
        data: {
          ...(node.data as StoryboardGenNodeData),
          onChangeRows: (nodeId: string, rows: number) =>
            updateNodeData(nodeId, (prev) => {
              const current = prev as StoryboardGenNodeData
              const nextRows = normalizeCount(rows)
              return { ...current, gridRows: nextRows, frames: ensureStoryboardGenFrames(nextRows, current.gridCols, current.frames) }
            }),
          onChangeCols: (nodeId: string, cols: number) =>
            updateNodeData(nodeId, (prev) => {
              const current = prev as StoryboardGenNodeData
              const nextCols = normalizeCount(cols)
              return { ...current, gridCols: nextCols, frames: ensureStoryboardGenFrames(current.gridRows, nextCols, current.frames) }
            }),
          onChangeModel: (nodeId: string, modelId: string) => updateNodeData(nodeId, (prev) => ({ ...prev, model: modelId, error: '' })),
          onChangeFrameDesc: (nodeId: string, frameId: string, value: string) =>
            updateNodeData(nodeId, (prev) => ({
              ...(prev as StoryboardGenNodeData),
              frames: (prev as StoryboardGenNodeData).frames.map((frame) =>
                frame.id === frameId ? { ...frame, description: value } : frame
              ),
            })),
          onGenerate: handleStoryboardGenerate,
        },
      }
    }

    if (node.type === CANVAS_NODE_TYPES.storyboardSplit) {
      return {
        ...node,
        data: {
          ...(node.data as StoryboardSplitNodeData),
          onChangeRows: (nodeId: string, rows: number) =>
            updateNodeData(nodeId, (prev) => {
              const current = prev as StoryboardSplitNodeData
              const nextRows = normalizeCount(rows)
              return { ...current, gridRows: nextRows, frames: ensureStoryboardSplitFrames(nextRows, current.gridCols, current.frames) }
            }),
          onChangeCols: (nodeId: string, cols: number) =>
            updateNodeData(nodeId, (prev) => {
              const current = prev as StoryboardSplitNodeData
              const nextCols = normalizeCount(cols)
              return { ...current, gridCols: nextCols, frames: ensureStoryboardSplitFrames(current.gridRows, nextCols, current.frames) }
            }),
          onSplitInput: handleStoryboardSplitInput,
          onChangeFrameNote: (nodeId: string, frameId: string, value: string) =>
            updateNodeData(nodeId, (prev) => ({
              ...(prev as StoryboardSplitNodeData),
              frames: (prev as StoryboardSplitNodeData).frames.map((frame) =>
                frame.id === frameId ? { ...frame, note: value } : frame
              ),
            })),
          onExport: handleStoryboardExport,
          onOpenImage: openImageViewer,
        },
      }
    }

    return node
  }), [
    nodes,
    handleUploadSelectFile,
    updateNodeData,
    openImageViewer,
    handleImageGenerate,
    openVideoViewer,
    handleStoryboardGenerate,
    handleStoryboardSplitInput,
    handleStoryboardExport,
  ])

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return
    if (connection.source === connection.target) return
    setEdges((prev) => {
      if (prev.some((edge) => edge.source === connection.source && edge.target === connection.target)) return prev
      return addEdge({ ...connection, id: createNodeId('edge') }, prev)
    })
  }, [setEdges])

  return {
    nodes,
    edges,
    viewNodes,
    viewport,
    imageViewerUrl,
    imageViewerPath,
    videoViewerUrl,
    videoViewerPath,
    onNodesChange,
    onEdgesChange,
    onConnect,
    setViewport,
    addNodeByType,
    closeImageViewer,
    closeVideoViewer,
  }
}
