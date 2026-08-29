import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { ICON_NODE_STORYBOARD } from '@/core/theme/icons'

import {
  CANVAS_NODE_TYPES,
  DEFAULT_ASPECT_RATIO,
  EXPORT_RESULT_NODE_DEFAULT_WIDTH,
  EXPORT_RESULT_NODE_LAYOUT_HEIGHT,
  type StoryboardGenNodeData,
} from '@/features/canvas/domain/canvasNodes'
import { EXPORT_RESULT_DISPLAY_NAME, resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay'
import { getDefaultModelId } from '@/features/canvas/domain/defaultModels'
import { getSocketColor, MODEL_PARAM_ID } from '@/features/canvas/domain/socketTypes'
import {
  areMediaOutputListsEqual,
  collectInputMediaByKind,
} from '@/features/canvas/application/graphMediaResolver'
import {
  areStringSetsEqual,
  areValueOverridesEqual,
  collectInputValues,
  getConnectedParamIds,
} from '@/features/canvas/application/graphValueResolver'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useNodeModelParams } from '@/features/canvas/params/useNodeModelParams'
import { ModelInputRow } from '@/features/canvas/params/ModelInputRow'
import { MediaInputRow } from '@/features/canvas/params/MediaInputRow'
import { NodeParamRows } from '@/features/canvas/params/NodeParamRows'
import { isParamVisible } from '@/components/params/paramVisibility'
import { resolveInputLimits } from '@/core/inputs/inputLimits'
import { registry } from '@/core/ModelRegistry'
import type { ModelTag } from '@/core/types'
import { analyzeRatioResolutionParams } from '@/core/params/ratioResolution'
import { transferModelParamOverridesBetweenModels } from '@/core/params/modelParamTransfer'
import { useCanvasGenerationProgressStore } from '@/stores/canvasGenerationProgressStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { showAlertDialog } from '@/stores/alertDialogStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader'
import { NodeLodPlaceholder } from '@/features/canvas/ui/NodeLodPlaceholder'
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle'
import {
  NODE_IDLE_BORDER_CLASS,
  NODE_PORT_NODE_CLASS,
  NODE_PORT_VISIBLE_CLASS,
  NODE_ROW_GAP_CLASS,
  NODE_SELECTED_BORDER_CLASS,
} from '@/features/canvas/ui/nodeControlStyles'
import PriceEstimate from '@/components/ui/PriceEstimate'
import {
  STORYBOARD_GEN_ICON_ADJUST,
  buildFrameDescriptionDrafts,
  generateFrameId,
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
import { registerCanvasNodeExecutor } from '@/features/canvas/application/canvasExecutionService'
import { commitCanvasGenerationOutputs } from '@/features/canvas/application/generationOutputApplicationService'
import {
  isNineGridStoryboard,
  NINE_GRID_PRESET_ID,
} from '@/features/canvas/capabilities/nineGridPolicy'
import { StoryboardGridEditor } from '@/features/canvas/nodes/storyboardGen/StoryboardGridEditor'
import { useStoryboardFramePrompts } from '@/features/canvas/nodes/storyboardGen/useStoryboardFramePrompts'

const StoryboardIcon = ICON_NODE_STORYBOARD

/** prompt/text 由分镜格子描述拼装，不进入逐行参数区 */
const PROMPT_PARAM_IDS = ['prompt', 'text']

/** 分镜生成始终向模型发送栅格参考图，因此只允许支持图片编辑的模型 */
const IMAGE_EDIT_REQUIRED_TAGS: ModelTag[] = ['image-to-image']

type StoryboardGenNodeProps = {
  id: string
  data: StoryboardGenNodeData
  selected?: boolean
  width?: number
  height?: number
}

export const StoryboardGenNode = memo(({ id, data, selected, width, height }: StoryboardGenNodeProps) => {
  const { t } = useTranslation()
  const updateNodeInternals = useUpdateNodeInternals()
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode)
  const updateNodeData = useCanvasStore((state) => state.updateNodeData)
  const setNodeGenerationProgress = useCanvasGenerationProgressStore((state) => state.setProgress)
  const addNode = useCanvasStore((state) => state.addNode)
  const addEdge = useCanvasStore((state) => state.addEdge)
  const hasSourceConnections = useCanvasStore((state) =>
    state.edges.some((edge) => edge.source === id)
  )
  const findNodePosition = useCanvasStore((state) => state.findNodePosition)
  const providerKeyStatus = useSettingsStore((state) => state.providerKeyStatus)
  const keepStyleConsistent = useSettingsStore((state) => state.storyboardGenKeepStyleConsistent)
  const disableTextInImage = useSettingsStore((state) => state.storyboardGenDisableTextInImage)
  const autoInferEmptyFrame = useSettingsStore((state) => state.storyboardGenAutoInferEmptyFrame)
  const ignoreAtTagWhenCopyingAndGenerating = useSettingsStore(
    (state) => state.ignoreAtTagWhenCopyingAndGenerating
  )

  const nodeData = data as StoryboardGenNodeData
  const nineGridPreset = isNineGridStoryboard(nodeData)
  const [error, setError] = useState<string | null>(null)
  const resolvedTitle = useMemo(
    () => resolveNodeDisplayName(CANVAS_NODE_TYPES.storyboardGen, nodeData),
    [nodeData]
  )

  // 内容相等比较的细粒度订阅：仅在上游图片实际变化时重渲染
  const incomingImageOutputs = useStoreWithEqualityFn(
    useCanvasStore,
    (state) => collectInputMediaByKind(id, state.nodes, state.edges, 'image'),
    areMediaOutputListsEqual
  )
  const mediaInputs = useMemo(() => nodeData.mediaInputs ?? {}, [nodeData.mediaInputs])
  const {
    frameDocuments,
    references: promptReferences,
    effectiveImages,
    onImageInputChange: handleImageInputChange,
    onFrameDocumentChange: handleFrameDescriptionChange,
  } = useStoryboardFramePrompts({
    nodeId: id,
    data: nodeData,
    incomingImages: incomingImageOutputs,
  })
  const frameDescriptionDrafts = useMemo(
    () => buildFrameDescriptionDrafts(nodeData.frames),
    [nodeData.frames],
  )

  // 模型端口覆盖：连上模型选择器节点后，节点内选择只读，生效模型以连线为准
  const connectedParamIds = useStoreWithEqualityFn(
    useCanvasStore,
    (state) => getConnectedParamIds(id, state.edges),
    areStringSetsEqual
  )
  const injectedValues = useStoreWithEqualityFn(
    useCanvasStore,
    (state) => collectInputValues(id, state.nodes, state.edges),
    areValueOverridesEqual
  )
  const isModelOverridden = connectedParamIds.has(MODEL_PARAM_ID)
  const overrideModelId = isModelOverridden && typeof injectedValues[MODEL_PARAM_ID] === 'string'
    ? injectedValues[MODEL_PARAM_ID] as string
    : null

  const selectedModelId = useMemo(() => {
    const stored = typeof nodeData.modelId === 'string' ? nodeData.modelId.trim() : ''
    const storedModel = stored ? registry.getModel(stored) : undefined
    if (storedModel && IMAGE_EDIT_REQUIRED_TAGS.every((tag) => storedModel.meta.tags?.includes(tag))) {
      return stored
    }
    return getDefaultModelId('image', IMAGE_EDIT_REQUIRED_TAGS)
  }, [nodeData.modelId])
  const effectiveModelId = overrideModelId ?? selectedModelId
  const effectiveModel = useMemo(() => registry.getModel(effectiveModelId), [effectiveModelId])
  const providerKeyConfigured = effectiveModel
    ? providerKeyStatus[effectiveModel.meta.provider] === true
    : false

  const handleParamsChange = useCallback((nextParams: DynamicValueMap) => {
    updateNodeData(id, { params: nextParams })
  }, [id, updateNodeData])

  const { schema: modelParamSchema, values: modelParamValues, setParam, setParams } = useNodeModelParams({
    modelId: effectiveModelId,
    storedParams: nodeData.params,
    onParamsChange: handleParamsChange,
    media: { images: effectiveImages },
  })

  const handleModelChange = useCallback((nextModelId: string) => {
    const transferredParams = transferModelParamOverridesBetweenModels(
      effectiveModelId,
      nextModelId,
      modelParamValues
    )
    updateNodeData(id, {
      modelId: nextModelId,
      params: transferredParams
    })
  }, [effectiveModelId, id, modelParamValues, updateNodeData])

  const ratioSpec = useMemo(
    () => analyzeRatioResolutionParams(modelParamSchema, effectiveImages),
    [effectiveImages, modelParamSchema]
  )

  // 图片行数量上限：由所选模型的 inputLimits 决定，0 表示该模型不支持图片输入
  const imageRowMax = useMemo(
    () => resolveInputLimits(effectiveModelId, modelParamValues).images.max,
    [effectiveModelId, modelParamValues]
  )

  // 逐行参数区行数（模型行 + 可选图片行 + 可见标量参数行），用于动态计算节点底部高度
  const paramsRowCount = useMemo(() => {
    const visibleParamCount = modelParamSchema.filter(
      (param) => !PROMPT_PARAM_IDS.includes(param.id) && isParamVisible(param, modelParamValues, null)
    ).length
    return 1 + (imageRowMax > 0 ? 1 : 0) + visibleParamCount
  }, [imageRowMax, modelParamSchema, modelParamValues])

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
    () => computeStoryboardBaseFrameLayout(frameAspectRatioValue, nodeData.gridCols, nodeData.gridRows, paramsRowCount),
    [frameAspectRatioValue, nodeData.gridCols, nodeData.gridRows, paramsRowCount]
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
        resolvedNodeWidth,
        paramsRowCount
      ),
    [frameAspectRatioValue, nodeData.gridCols, nodeData.gridRows, resolvedNodeHeight, resolvedNodeWidth, paramsRowCount]
  )

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
      frameDescriptionDrafts,
      keepStyleConsistent,
      disableTextInImage,
      autoInferEmptyFrame,
    }),
    [autoInferEmptyFrame, disableTextInImage, frameDescriptionDrafts, keepStyleConsistent, nodeData]
  )

  const handleGenerate = useCallback(async (): Promise<void> => {
    const prompt = buildPrompt()
    if (!prompt) {
      setError('请填写至少一个分镜内容描述')
      return
    }
    // 缺 API Key 有明确补救动作，走带「去设置」的统一弹窗（与 GenerationNodeShell 一致）
    if (!providerKeyConfigured) {
      showAlertDialog({
        title: t('common:providerKeyRequired.title'),
        message: t('common:providerKeyRequired.message'),
        type: 'info',
        settingsTarget: { tab: 'models', sectionId: 'models-providers' },
      })
      return
    }

    // 连线注入的标量值优先覆盖内联值（数值/源节点 → 参数端口）
    const { nodes: graphNodes, edges: graphEdges } = useCanvasStore.getState()
    const injectedParamValues = collectInputValues(id, graphNodes, graphEdges)
    const generationParams: DynamicValueMap = {
      ...modelParamValues,
      ...injectedParamValues,
      prompt,
      text: prompt,
    }
    const estimateParams: DynamicValueMap = {
      ...generationParams,
      ...(effectiveImages.length > 0
        ? {
          images: effectiveImages,
          uploadedFilePaths: effectiveImages,
        }
        : {}),
    }
    const estimate = await GenerationService.getInstance().getProgressEstimate(
      effectiveModelId,
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
      modelId: effectiveModelId,
      params: { ...modelParamValues },
    })

    addEdge(id, newNodeId)
    setSelectedNode(null)
    setError(null)

    try {
      const generated = await generateStoryboardImage({
        modelId: effectiveModelId,
        params: generationParams,
        incomingImages: effectiveImages,
        frameAspectRatioValue,
        gridRows: nodeData.gridRows,
        gridCols: nodeData.gridCols,
        gridImageResolution: gridResolutionValue,
        frames: nodeData.frames,
        frameDescriptionDrafts,
        ignoreAtTagWhenCopyingAndGenerating,
        onProgress: (progress) => setNodeGenerationProgress(newNodeId, progress),
      })

      await commitCanvasGenerationOutputs({
        sourceNodeId: id,
        placeholderNodeId: newNodeId,
        resultNodeType: CANVAS_NODE_TYPES.exportImage,
        contract: generated.contract,
        completionId: `storyboard-grid:${newNodeId}`,
        groupTitle: `${resolvedTitle} · ${generated.contract.outputs.length}`,
      })
    } catch (generationError) {
      // 失败信息写回输出节点，红边 + 原因长在失败的那次生成上
      updateNodeData(newNodeId, {
        isGenerating: false,
        generationStartedAt: null,
        generationError:
          generationError instanceof Error ? generationError.message : '生成失败',
      })
    } finally {
      setNodeGenerationProgress(newNodeId, null)
    }
  }, [addEdge, addNode, buildPrompt, effectiveImages, effectiveModelId, findNodePosition, frameAspectRatioValue, frameDescriptionDrafts, gridResolutionValue, id, ignoreAtTagWhenCopyingAndGenerating, modelParamValues, nodeData.frames, nodeData.gridCols, nodeData.gridRows, providerKeyConfigured, resolvedTitle, setNodeGenerationProgress, setSelectedNode, t, updateNodeData])

  useEffect(() => registerCanvasNodeExecutor(id, {
    kind: 'storyboard-generation',
    run: handleGenerate,
  }), [handleGenerate, id])

  const handleRowChange = useCallback((delta: number): void => {
    if (nineGridPreset) return
    const nextRows = Math.max(1, Math.min(9, nodeData.gridRows + delta))
    updateNodeData(id, { gridRows: nextRows })
  }, [id, nineGridPreset, nodeData.gridRows, updateNodeData])

  const handleColChange = useCallback((delta: number): void => {
    if (nineGridPreset) return
    const nextCols = Math.max(1, Math.min(9, nodeData.gridCols + delta))
    updateNodeData(id, { gridCols: nextCols })
  }, [id, nineGridPreset, nodeData.gridCols, updateNodeData])

  return (
    <div
      className={`
        group relative flex h-full flex-col overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/95 p-3 transition-colors duration-150
        ${selected
          ? NODE_SELECTED_BORDER_CLASS
          : NODE_IDLE_BORDER_CLASS
        }
      `}
      style={{ width: `${resolvedNodeWidth}px`, height: `${resolvedNodeHeight}px` }}
      data-storyboard-preset={nineGridPreset ? NINE_GRID_PRESET_ID : 'free'}
      onClick={() => setSelectedNode(id)}
    >
      <NodeHeader
        className={`${NODE_HEADER_FLOATING_POSITION_CLASS} canvas-node-lod-detail`}
        icon={<StoryboardIcon className="h-4 w-4" />}
        titleText={resolvedTitle}
        iconAdjust={STORYBOARD_GEN_ICON_ADJUST}
        editable
        onTitleChange={(nextTitle) => updateNodeData(id, { displayName: nextTitle })}
        rightSlot={effectiveModel && (
          <PriceEstimate
            providerId={effectiveModel.meta.provider}
            modelId={effectiveModelId}
            params={modelParamValues}
            variant="badge"
          />
        )}
      />

      <NodeLodPlaceholder title={resolvedTitle} icon={<StoryboardIcon className="h-6 w-6" />} />

      <StoryboardGridEditor
        nodeId={id}
        selected={Boolean(selected)}
        nodeData={nodeData}
        totalFrames={totalFrames}
        frameLayout={frameLayout}
        frameDocuments={frameDocuments}
        references={promptReferences}
        gridLocked={nineGridPreset}
        onSelectNode={() => setSelectedNode(id)}
        onRowChange={handleRowChange}
        onColChange={handleColChange}
        onFrameDescriptionChange={handleFrameDescriptionChange}
      />

      {error && <div className="canvas-node-lod-detail mb-1.5 shrink-0 text-3xs text-red-400">{error}</div>}

      <div className={`canvas-node-lod-detail flex shrink-0 flex-col ${NODE_ROW_GAP_CLASS}`}>
        <ModelInputRow
          mediaType="image"
          modelId={selectedModelId}
          overrideModelId={overrideModelId}
          storedParams={nodeData.params}
          onModelChange={handleModelChange}
          onParamsChange={handleParamsChange}
          incomingImages={effectiveImages}
          requiredTags={IMAGE_EDIT_REQUIRED_TAGS}
        />
        {imageRowMax > 0 && (
          <MediaInputRow
            nodeId={id}
            mediaKind="image"
            label={t('node.mediaRow.image')}
            maxCount={imageRowMax}
            inlineValue={mediaInputs.image ?? []}
            onInlineChange={handleImageInputChange}
          />
        )}
        <NodeParamRows
          nodeId={id}
          modelId={effectiveModelId}
          schema={modelParamSchema}
          values={modelParamValues}
          setParam={setParam}
          setParams={setParams}
          excludeParamIds={PROMPT_PARAM_IDS}
        />
      </div>

      <Handle
        type="source"
        id="source"
        position={Position.Right}
        style={{ background: getSocketColor('IMAGE') }}
        className={`${NODE_PORT_NODE_CLASS} ${hasSourceConnections ? NODE_PORT_VISIBLE_CLASS : ''}`}
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
