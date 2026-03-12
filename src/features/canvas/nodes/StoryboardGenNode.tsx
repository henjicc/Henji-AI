import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Handle, Position, useUpdateNodeInternals, useViewport } from '@xyflow/react'
import { Sparkles } from 'lucide-react'

import {
  AUTO_REQUEST_ASPECT_RATIO,
  CANVAS_NODE_TYPES,
  DEFAULT_ASPECT_RATIO,
  EXPORT_RESULT_NODE_DEFAULT_WIDTH,
  EXPORT_RESULT_NODE_LAYOUT_HEIGHT,
  type ImageSize,
  type StoryboardGenNodeData,
} from '@/features/canvas/domain/canvasNodes'
import { EXPORT_RESULT_DISPLAY_NAME, resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay'
import { graphImageResolver } from '@/features/canvas/application/canvasServices'
import { getDefaultImageModelId, getImageModel, listImageModels } from '@/features/canvas/models'
import { useCanvasStore } from '@/stores/canvasStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader'
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle'
import {
  type AspectRatioChoice,
  AUTO_ASPECT_RATIO_OPTION,
  STORYBOARD_GEN_HEADER_ADJUST,
  STORYBOARD_GEN_ICON_ADJUST,
  STORYBOARD_GEN_TITLE_ADJUST,
  areFrameDescriptionDraftsEqual,
  buildFrameDescriptionDrafts,
  generateFrameId,
  resolveReferenceIndexFromDescription,
} from '@/features/canvas/nodes/storyboardGen/shared'
import {
  computeStoryboardBaseFrameLayout,
  computeStoryboardFrameLayout,
} from '@/features/canvas/nodes/storyboardGen/layout'
import {
  buildStoryboardPrompt,
  generateStoryboardImage,
} from '@/features/canvas/nodes/storyboardGen/generation'
import { StoryboardGridEditor } from '@/features/canvas/nodes/storyboardGen/StoryboardGridEditor'
import { StoryboardParamsBar } from '@/features/canvas/nodes/storyboardGen/StoryboardParamsBar'

type StoryboardGenNodeProps = {
  id: string
  data: StoryboardGenNodeData
  selected?: boolean
  width?: number
  height?: number
}

export const StoryboardGenNode = memo(({ id, data, selected, width, height }: StoryboardGenNodeProps) => {
  const { zoom } = useViewport()
  const updateNodeInternals = useUpdateNodeInternals()
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode)
  const nodes = useCanvasStore((state) => state.nodes)
  const edges = useCanvasStore((state) => state.edges)
  const updateNodeData = useCanvasStore((state) => state.updateNodeData)
  const addNode = useCanvasStore((state) => state.addNode)
  const addEdge = useCanvasStore((state) => state.addEdge)
  const findNodePosition = useCanvasStore((state) => state.findNodePosition)
  const providerKeyStatus = useSettingsStore((state) => state.providerKeyStatus)
  const keepStyleConsistent = useSettingsStore((state) => state.storyboardGenKeepStyleConsistent)
  const disableTextInImage = useSettingsStore((state) => state.storyboardGenDisableTextInImage)
  const ignoreAtTagWhenCopyingAndGenerating = useSettingsStore(
    (state) => state.ignoreAtTagWhenCopyingAndGenerating
  )

  const nodeData = data as StoryboardGenNodeData
  const [error, setError] = useState<string | null>(null)
  const [frameDescriptionDrafts, setFrameDescriptionDrafts] = useState<Record<string, string>>(() =>
    buildFrameDescriptionDrafts(nodeData.frames)
  )
  const frameDescriptionDraftsRef = useRef(frameDescriptionDrafts)
  const imageModels = useMemo(() => listImageModels(), [])
  const resolvedTitle = useMemo(
    () => resolveNodeDisplayName(CANVAS_NODE_TYPES.storyboardGen, nodeData),
    [nodeData]
  )

  const incomingImages = useMemo(
    () => graphImageResolver.collectInputImages(id, nodes, edges),
    [id, nodes, edges]
  )
  const incomingImageItems = useMemo(
    () =>
      incomingImages.map((imageUrl, index) => ({
        id: `image-ref-${index}`,
        label: `图${index + 1}`,
        thumbnailSrc: imageUrl,
      })),
    [incomingImages]
  )

  const selectedModel = useMemo(() => {
    const modelId = nodeData.model ?? getDefaultImageModelId()
    return getImageModel(modelId)
  }, [nodeData.model])
  const providerKeyConfigured = providerKeyStatus[selectedModel.providerId] === true

  const selectedResolution = useMemo((): AspectRatioChoice => {
    const found = nodeData.size
      ? selectedModel.resolutions.find((item) => item.value === nodeData.size)
      : undefined
    return found
      ?? selectedModel.resolutions.find((item) => item.value === selectedModel.defaultResolution)
      ?? selectedModel.resolutions[0]
  }, [nodeData.size, selectedModel])

  const aspectRatioOptions = useMemo<AspectRatioChoice[]>(
    () => [AUTO_ASPECT_RATIO_OPTION, ...selectedModel.aspectRatios],
    [selectedModel.aspectRatios]
  )
  const selectedAspectRatio = useMemo((): AspectRatioChoice => {
    const found = nodeData.requestAspectRatio
      ? aspectRatioOptions.find((item) => item.value === nodeData.requestAspectRatio)
      : undefined
    return found ?? AUTO_ASPECT_RATIO_OPTION
  }, [aspectRatioOptions, nodeData.requestAspectRatio])

  const frameAspectRatioValue = useMemo(() => {
    if (selectedAspectRatio.value === AUTO_REQUEST_ASPECT_RATIO) {
      return nodeData.aspectRatio || DEFAULT_ASPECT_RATIO
    }
    return selectedAspectRatio.value || DEFAULT_ASPECT_RATIO
  }, [nodeData.aspectRatio, selectedAspectRatio.value])

  const baseFrameLayout = useMemo(
    () => computeStoryboardBaseFrameLayout(frameAspectRatioValue, nodeData.gridCols, nodeData.gridRows),
    [frameAspectRatioValue, nodeData.gridCols, nodeData.gridRows]
  )
  const requestResolution = selectedModel.resolveRequest({ referenceImageCount: incomingImages.length })
  const supportedAspectRatioValues = useMemo(
    () => selectedModel.aspectRatios.map((item) => item.value),
    [selectedModel.aspectRatios]
  )
  const totalFrames = useMemo(
    () => (nodeData.gridRows ?? 1) * (nodeData.gridCols ?? 1),
    [nodeData.gridCols, nodeData.gridRows]
  )

  const resolvedNodeWidth = Math.max(baseFrameLayout.nodeWidth, Math.round(width ?? baseFrameLayout.nodeWidth))
  const resolvedNodeHeight = Math.max(baseFrameLayout.nodeHeight, Math.round(height ?? baseFrameLayout.nodeHeight))
  const frameLayout = useMemo(
    () =>
      computeStoryboardFrameLayout(
        frameAspectRatioValue,
        nodeData.gridCols,
        nodeData.gridRows,
        resolvedNodeHeight,
        resolvedNodeWidth
      ),
    [frameAspectRatioValue, nodeData.gridCols, nodeData.gridRows, resolvedNodeHeight, resolvedNodeWidth]
  )

  useEffect(() => {
    frameDescriptionDraftsRef.current = frameDescriptionDrafts
  }, [frameDescriptionDrafts])

  useEffect(() => {
    const nextDrafts = buildFrameDescriptionDrafts(nodeData.frames)
    setFrameDescriptionDrafts((previous) => (
      areFrameDescriptionDraftsEqual(previous, nextDrafts) ? previous : nextDrafts
    ))
  }, [nodeData.frames])

  useEffect(() => {
    updateNodeInternals(id)
  }, [id, resolvedNodeHeight, resolvedNodeWidth, updateNodeInternals])

  useEffect(() => {
    const patch: Partial<StoryboardGenNodeData> = {}
    if (nodeData.model !== selectedModel.id) {
      patch.model = selectedModel.id
    }
    if (nodeData.size !== selectedResolution.value) {
      patch.size = selectedResolution.value as ImageSize
    }
    if (nodeData.requestAspectRatio !== selectedAspectRatio.value) {
      patch.requestAspectRatio = selectedAspectRatio.value
    }
    if (Object.keys(patch).length > 0) {
      updateNodeData(id, patch)
    }
  }, [id, nodeData.model, nodeData.requestAspectRatio, nodeData.size, selectedAspectRatio.value, selectedModel.id, selectedResolution.value, updateNodeData])

  useEffect(() => {
    if (nodeData.frames.length === totalFrames) {
      return
    }
    const nextFrames: StoryboardGenNodeData['frames'] = []
    for (let index = 0; index < totalFrames; index += 1) {
      if (index < nodeData.frames.length) {
        nextFrames.push(nodeData.frames[index])
      } else {
        nextFrames.push({
          id: generateFrameId(),
          description: '',
          referenceIndex: null,
        })
      }
    }
    updateNodeData(id, { frames: nextFrames })
  }, [id, nodeData.frames, totalFrames, updateNodeData])

  const buildPrompt = useCallback(
    (): string => buildStoryboardPrompt({
      nodeData,
      frameDescriptionDrafts: frameDescriptionDraftsRef.current,
      keepStyleConsistent,
      disableTextInImage,
    }),
    [disableTextInImage, keepStyleConsistent, nodeData]
  )

  const handleGenerate = useCallback(async (): Promise<void> => {
    const prompt = buildPrompt()
    if (!prompt) {
      setError('请填写至少一个分镜内容描述')
      return
    }
    if (!providerKeyConfigured) {
      setError('请在设置中填写 API Key')
      return
    }

    const generationDurationMs = selectedModel.expectedDurationMs ?? 60000
    const generationStartedAt = Date.now()
    const newNodePosition = findNodePosition(
      id,
      EXPORT_RESULT_NODE_DEFAULT_WIDTH,
      EXPORT_RESULT_NODE_LAYOUT_HEIGHT
    )
    const newNodeId = addNode(CANVAS_NODE_TYPES.exportImage, newNodePosition, {
      isGenerating: true,
      generationStartedAt,
      generationDurationMs,
      displayName: EXPORT_RESULT_DISPLAY_NAME.storyboardGenOutput,
      resultKind: 'storyboardGenOutput',
      prompt: '',
      model: selectedModel.id,
      size: selectedResolution.value as ImageSize,
      requestAspectRatio: selectedAspectRatio.value,
    })

    addEdge(id, newNodeId)
    setSelectedNode(null)
    setError(null)

    try {
      const generated = await generateStoryboardImage({
        prompt,
        providerId: selectedModel.providerId,
        selectedAspectRatio: selectedAspectRatio.value,
        incomingImages,
        supportedAspectRatioValues,
        frameAspectRatioValue,
        gridRows: nodeData.gridRows,
        gridCols: nodeData.gridCols,
        selectedResolution: selectedResolution.value,
        requestModel: requestResolution.requestModel,
        extraParams: nodeData.extraParams,
        frames: nodeData.frames,
        frameDescriptionDrafts: frameDescriptionDraftsRef.current,
        ignoreAtTagWhenCopyingAndGenerating,
      })

      updateNodeData(newNodeId, {
        imageUrl: generated.imageUrl,
        previewImageUrl: generated.previewImageUrl,
        aspectRatio: generated.aspectRatio,
        isGenerating: false,
        generationStartedAt: null,
      })
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : '生成失败')
      updateNodeData(newNodeId, { isGenerating: false, generationStartedAt: null })
    }
  }, [addEdge, addNode, buildPrompt, findNodePosition, frameAspectRatioValue, id, ignoreAtTagWhenCopyingAndGenerating, incomingImages, nodeData.extraParams, nodeData.frames, nodeData.gridCols, nodeData.gridRows, providerKeyConfigured, requestResolution.requestModel, selectedAspectRatio.value, selectedModel.expectedDurationMs, selectedModel.id, selectedModel.providerId, selectedResolution.value, setSelectedNode, supportedAspectRatioValues, updateNodeData])

  const handleRowChange = useCallback((delta: number): void => {
    const nextRows = Math.max(1, Math.min(9, nodeData.gridRows + delta))
    updateNodeData(id, { gridRows: nextRows })
  }, [id, nodeData.gridRows, updateNodeData])

  const handleColChange = useCallback((delta: number): void => {
    const nextCols = Math.max(1, Math.min(9, nodeData.gridCols + delta))
    updateNodeData(id, { gridCols: nextCols })
  }, [id, nodeData.gridCols, updateNodeData])

  const handleFrameDescriptionChange = useCallback((index: number, description: string): void => {
    const frame = nodeData.frames[index]
    if (!frame) {
      return
    }

    setFrameDescriptionDrafts((previous) => (
      previous[frame.id] === description ? previous : { ...previous, [frame.id]: description }
    ))

    const referenceIndex = resolveReferenceIndexFromDescription(description, incomingImages.length)
    if (frame.description === description && frame.referenceIndex === referenceIndex) {
      return
    }

    const nextFrames = [...nodeData.frames]
    nextFrames[index] = { ...frame, description, referenceIndex }
    updateNodeData(id, { frames: nextFrames })
  }, [id, incomingImages.length, nodeData.frames, updateNodeData])

  return (
    <div
      className={`
        group relative flex h-full flex-col overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/95 p-3 transition-colors duration-150
        ${selected
          ? 'border-accent shadow-[0_0_0_1px_rgba(59,130,246,0.32)]'
          : 'border-[rgba(255,255,255,0.22)] hover:border-[rgba(255,255,255,0.34)]'
        }
      `}
      style={{ width: `${resolvedNodeWidth}px`, height: `${resolvedNodeHeight}px` }}
      onClick={() => setSelectedNode(id)}
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={<Sparkles className="h-4 w-4" />}
        titleText={resolvedTitle}
        headerAdjust={STORYBOARD_GEN_HEADER_ADJUST}
        iconAdjust={STORYBOARD_GEN_ICON_ADJUST}
        titleAdjust={STORYBOARD_GEN_TITLE_ADJUST}
        editable
        onTitleChange={(nextTitle) => updateNodeData(id, { displayName: nextTitle })}
      />

      <StoryboardGridEditor
        nodeData={nodeData}
        totalFrames={totalFrames}
        frameLayout={frameLayout}
        zoom={zoom}
        frameDescriptionDrafts={frameDescriptionDrafts}
        incomingImageItems={incomingImageItems}
        onRowChange={handleRowChange}
        onColChange={handleColChange}
        onFrameDescriptionChange={handleFrameDescriptionChange}
      />

      {error && <div className="mb-1.5 shrink-0 text-[10px] text-red-400">{error}</div>}

      <StoryboardParamsBar
        frameLayout={frameLayout}
        imageModels={imageModels}
        selectedModel={selectedModel}
        selectedResolution={selectedResolution}
        selectedAspectRatio={selectedAspectRatio}
        aspectRatioOptions={aspectRatioOptions}
        onModelChange={(modelId) => updateNodeData(id, { model: modelId })}
        onResolutionChange={(resolution) => updateNodeData(id, { size: resolution })}
        onAspectRatioChange={(aspectRatio) => updateNodeData(id, { requestAspectRatio: aspectRatio })}
        onGenerate={handleGenerate}
      />

      <Handle
        type="target"
        id="target"
        position={Position.Left}
        className="!h-2 !w-2 !border-surface-dark !bg-accent"
      />
      <Handle
        type="source"
        id="source"
        position={Position.Right}
        className="!h-2 !w-2 !border-surface-dark !bg-accent"
      />
      <NodeResizeHandle
        minWidth={baseFrameLayout.nodeWidth}
        minHeight={baseFrameLayout.nodeHeight}
        maxWidth={1800}
        maxHeight={1400}
      />
    </div>
  )
})

StoryboardGenNode.displayName = 'StoryboardGenNode'
