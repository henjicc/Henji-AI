import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Handle, Position, useUpdateNodeInternals, useViewport } from '@xyflow/react'
import { Sparkles } from 'lucide-react'

import {
  CANVAS_NODE_TYPES,
  DEFAULT_ASPECT_RATIO,
  EXPORT_RESULT_NODE_DEFAULT_WIDTH,
  EXPORT_RESULT_NODE_LAYOUT_HEIGHT,
  type StoryboardGenNodeData,
} from '@/features/canvas/domain/canvasNodes'
import { EXPORT_RESULT_DISPLAY_NAME, resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay'
import { getDefaultModelId } from '@/features/canvas/domain/defaultModels'
import {
  areStringListsEqual,
  collectInputMediaUrls,
} from '@/features/canvas/application/graphMediaResolver'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useNodeModelParams } from '@/features/canvas/params/useNodeModelParams'
import { registry } from '@/core/ModelRegistry'
import { analyzeRatioResolutionParams } from '@/core/params/ratioResolution'
import { useCanvasStore } from '@/stores/canvasStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader'
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle'
import {
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
import { GenerationService } from '@/core/services/GenerationService'
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
  const updateNodeData = useCanvasStore((state) => state.updateNodeData)
  const setNodeGenerationProgress = useCanvasStore((state) => state.setNodeGenerationProgress)
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
  const resolvedTitle = useMemo(
    () => resolveNodeDisplayName(CANVAS_NODE_TYPES.storyboardGen, nodeData),
    [nodeData]
  )

  // 内容相等比较的细粒度订阅：仅在上游图片实际变化时重渲染
  const incomingImages = useStoreWithEqualityFn(
    useCanvasStore,
    (state) => collectInputMediaUrls(id, state.nodes, state.edges, 'image'),
    areStringListsEqual
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

  const selectedModelId = useMemo(() => {
    const stored = typeof nodeData.modelId === 'string' ? nodeData.modelId.trim() : ''
    if (stored && registry.getModel(stored)) {
      return stored
    }
    return getDefaultModelId('image')
  }, [nodeData.modelId])
  const selectedModel = useMemo(() => registry.getModel(selectedModelId), [selectedModelId])
  const providerKeyConfigured = selectedModel
    ? providerKeyStatus[selectedModel.meta.provider] === true
    : false

  const handleParamsChange = useCallback((nextParams: Record<string, unknown>) => {
    updateNodeData(id, { params: nextParams })
  }, [id, updateNodeData])

  const { schema: modelParamSchema, values: modelParamValues } = useNodeModelParams({
    modelId: selectedModelId,
    storedParams: nodeData.params,
    onParamsChange: handleParamsChange,
  })

  const handleModelChange = useCallback((nextModelId: string) => {
    updateNodeData(id, { modelId: nextModelId, params: {} })
  }, [id, updateNodeData])

  const ratioSpec = useMemo(
    () => analyzeRatioResolutionParams(modelParamSchema, incomingImages),
    [incomingImages, modelParamSchema]
  )

  // 栅格布局所需的具体宽高比：取 schema 宽高比参数当前值，smart/缺失时回退已检测比例
  const frameAspectRatioValue = useMemo(() => {
    const aspectParamId = ratioSpec?.aspectParam?.id
    const value = aspectParamId ? modelParamValues[aspectParamId] : undefined
    if (typeof value === 'string' && /^\d+\s*:\s*\d+$/.test(value.trim())) {
      return value.trim()
    }
    return nodeData.aspectRatio || DEFAULT_ASPECT_RATIO
  }, [modelParamValues, nodeData.aspectRatio, ratioSpec])

  // 栅格参考图绘制分辨率：取 schema 分辨率参数当前值，缺失时使用 2K
  const gridResolutionValue = useMemo(() => {
    const resolutionParamId = ratioSpec?.resolutionParam?.id
    const value = resolutionParamId ? modelParamValues[resolutionParamId] : undefined
    return typeof value === 'string' && value ? value : '2K'
  }, [modelParamValues, ratioSpec])

  const baseFrameLayout = useMemo(
    () => computeStoryboardBaseFrameLayout(frameAspectRatioValue, nodeData.gridCols, nodeData.gridRows),
    [frameAspectRatioValue, nodeData.gridCols, nodeData.gridRows]
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
    if (nodeData.modelId !== selectedModelId) {
      updateNodeData(id, { modelId: selectedModelId })
    }
  }, [id, nodeData.modelId, selectedModelId, updateNodeData])

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

    const generationParams: Record<string, unknown> = {
      ...modelParamValues,
      prompt,
      text: prompt,
    }
    const estimateParams: Record<string, unknown> = {
      ...generationParams,
      ...(incomingImages.length > 0
        ? {
          images: incomingImages,
          uploadedFilePaths: incomingImages,
        }
        : {}),
    }
    const estimate = await GenerationService.getInstance().getProgressEstimate(
      selectedModelId,
      estimateParams
    )
    const generationDurationMs = estimate?.durationMs ?? 60_000
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
      modelId: selectedModelId,
      params: { ...modelParamValues },
    })

    addEdge(id, newNodeId)
    setSelectedNode(null)
    setError(null)

    try {
      const generated = await generateStoryboardImage({
        modelId: selectedModelId,
        params: generationParams,
        incomingImages,
        frameAspectRatioValue,
        gridRows: nodeData.gridRows,
        gridCols: nodeData.gridCols,
        gridImageResolution: gridResolutionValue,
        frames: nodeData.frames,
        frameDescriptionDrafts: frameDescriptionDraftsRef.current,
        ignoreAtTagWhenCopyingAndGenerating,
        onProgress: (progress) => setNodeGenerationProgress(newNodeId, progress),
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
    } finally {
      setNodeGenerationProgress(newNodeId, null)
    }
  }, [addEdge, addNode, buildPrompt, findNodePosition, frameAspectRatioValue, gridResolutionValue, id, ignoreAtTagWhenCopyingAndGenerating, incomingImages, modelParamValues, nodeData.frames, nodeData.gridCols, nodeData.gridRows, providerKeyConfigured, selectedModelId, setNodeGenerationProgress, setSelectedNode, updateNodeData])

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
        modelId={selectedModelId}
        providerId={selectedModel?.meta.provider ?? ''}
        storedParams={nodeData.params}
        mergedParams={modelParamValues}
        incomingImages={incomingImages}
        onModelChange={handleModelChange}
        onParamsChange={handleParamsChange}
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
