import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { ICON_NODE_STORYBOARD } from '@/core/theme/icons'

import { CANVAS_NODE_TYPES, DEFAULT_ASPECT_RATIO, EXPORT_RESULT_NODE_DEFAULT_WIDTH, EXPORT_RESULT_NODE_LAYOUT_HEIGHT, type StoryboardGenNodeData } from '@/features/canvas/domain/canvasNodes'
import { EXPORT_RESULT_DISPLAY_NAME, resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay'
import { getDefaultModelId } from '@/features/canvas/domain/defaultModels'
import { getSocketColor, MODEL_PARAM_ID } from '@/features/canvas/domain/socketTypes'
import { areMediaOutputListsEqual, collectInputMediaByKind } from '@/features/canvas/application/graphMediaResolver'
import { areStringSetsEqual, areValueOverridesEqual, collectInputValues, getConnectedParamIds } from '@/features/canvas/application/graphValueResolver'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useNodeModelParams } from '@/features/canvas/params/useNodeModelParams'
import { ModelInputRow } from '@/features/canvas/params/ModelInputRow'
import { MediaInputRow } from '@/features/canvas/params/MediaInputRow'
import { NodeParamRows } from '@/features/canvas/params/NodeParamRows'
import { isParamVisible } from '@/components/params/paramVisibility'
import { resolveInputLimits } from '@/core/inputs/inputLimits'
import { registry } from '@/core/ModelRegistry'
import { analyzeRatioResolutionParams } from '@/core/params/ratioResolution'
import { transferModelParamOverridesBetweenModels } from '@/core/params/modelParamTransfer'
import { useCanvasGenerationProgressStore } from '@/stores/canvasGenerationProgressStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { showAlertDialog } from '@/stores/alertDialogStore'
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader'
import { NodeLodPlaceholder } from '@/features/canvas/ui/NodeLodPlaceholder'
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle'
import { NODE_IDLE_BORDER_CLASS, NODE_PORT_NODE_CLASS, NODE_PORT_VISIBLE_CLASS, NODE_ROW_GAP_CLASS, NODE_SELECTED_BORDER_CLASS } from '@/features/canvas/ui/nodeControlStyles'
import PriceEstimate from '@/components/ui/PriceEstimate'
import { STORYBOARD_GEN_ICON_ADJUST, generateFrameId } from '@/features/canvas/nodes/storyboardGen/shared'
import { computeStoryboardBaseFrameLayout, computeStoryboardFrameLayout } from '@/features/canvas/nodes/storyboardGen/layout'
import { generateStoryboardImage } from '@/features/canvas/nodes/storyboardGen/generation'
import {
  getStoryboardExecutionSignatureExtras,
  resolveStoryboardExecutionInput,
  STORYBOARD_IMAGE_EDIT_REQUIRED_TAGS,
} from '@/features/canvas/nodes/storyboardGen/storyboardExecutionInput'
import { GenerationService } from '@/core/services/GenerationService'
import {
  registerCanvasNodeExecutor,
  type CanvasNodeExecutionContext,
  type CanvasNodeExecutionResult,
  type CanvasNodePreflightContext,
} from '@/features/canvas/application/canvasExecutionService'
import { isCanvasProjectContextCurrent } from '@/features/canvas/application/canvasApplicationService'
import { commitCanvasGenerationOutputs } from '@/features/canvas/application/generationOutputApplicationService'
import { STORYBOARD_GENERATION_RESUME_CONTEXT_FIELD } from '@/features/canvas/application/storyboardGenerationOutputService'
import {
  isNineGridStoryboard,
  NINE_GRID_PRESET_ID,
} from '@/features/canvas/capabilities/nineGridPolicy'
import { StoryboardGridEditor } from '@/features/canvas/nodes/storyboardGen/StoryboardGridEditor'
import { useStoryboardFramePrompts } from '@/features/canvas/nodes/storyboardGen/useStoryboardFramePrompts'
import { createCanvasGenerationTaskLifecycle } from '@/features/canvas/generation/activeGenerationTasks'

const StoryboardIcon = ICON_NODE_STORYBOARD

/** prompt/text 由分镜格子描述拼装，不进入逐行参数区 */
const PROMPT_PARAM_IDS = ['prompt', 'text']

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

  const nodeData = data as StoryboardGenNodeData
  const nineGridPreset = isNineGridStoryboard(nodeData)
  const [error, setError] = useState<string | null>(null)
  const resolvedTitle = useMemo(
    () => resolveNodeDisplayName(CANVAS_NODE_TYPES.storyboardGen, nodeData),
    [nodeData]
  )

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
    if (storedModel && STORYBOARD_IMAGE_EDIT_REQUIRED_TAGS.every((tag) => storedModel.meta.tags?.includes(tag))) {
      return stored
    }
    return getDefaultModelId('image', STORYBOARD_IMAGE_EDIT_REQUIRED_TAGS)
  }, [nodeData.modelId])
  const effectiveModelId = overrideModelId ?? selectedModelId
  const effectiveModel = useMemo(() => registry.getModel(effectiveModelId), [effectiveModelId])

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

  const imageRowMax = useMemo(
    () => resolveInputLimits(effectiveModelId, modelParamValues).images.max,
    [effectiveModelId, modelParamValues]
  )

  const paramsRowCount = useMemo(() => {
    const visibleParamCount = modelParamSchema.filter(
      (param) => !PROMPT_PARAM_IDS.includes(param.id) && isParamVisible(param, modelParamValues, null)
    ).length
    return 1 + (imageRowMax > 0 ? 1 : 0) + visibleParamCount
  }, [imageRowMax, modelParamSchema, modelParamValues])

  const frameAspectRatioValue = useMemo(() => {
    const aspectParamId = ratioSpec?.aspectParam?.id
    const value = aspectParamId ? modelParamValues[aspectParamId] : undefined
    if (typeof value === 'string' && /^\d+\s*:\s*\d+$/.test(value.trim())) {
      return value.trim()
    }
    return nodeData.aspectRatio || DEFAULT_ASPECT_RATIO
  }, [modelParamValues, nodeData.aspectRatio, ratioSpec])

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

  const handleGenerate = useCallback(async (
    execution: CanvasNodeExecutionContext,
  ): Promise<CanvasNodeExecutionResult> => {
    const generationProjectId = execution.projectId
    if (!generationProjectId) throw new Error('当前没有可执行生成的画布项目')
    const isGenerationProjectCurrent = (): boolean => (
      isCanvasProjectContextCurrent(generationProjectId)
    )
    const runtime = resolveStoryboardExecutionInput(id)
    if (
      !runtime.model
      || !STORYBOARD_IMAGE_EDIT_REQUIRED_TAGS.every((tag) => runtime.model?.meta.tags?.includes(tag))
    ) throw new Error('当前模型不支持分镜图生图')
    const prompt = runtime.prompt
    if (!prompt) {
      setError('请填写至少一个分镜内容描述')
      throw new Error('请填写至少一个分镜内容描述')
    }
    if (!runtime.providerConfigured) {
      showAlertDialog({
        title: t('common:providerKeyRequired.title'),
        message: t('common:providerKeyRequired.message'),
        type: 'info',
        settingsTarget: { tab: 'models', sectionId: 'models-providers' },
      })
      throw new Error(t('common:providerKeyRequired.message'))
    }

    const generationParams: DynamicValueMap = {
      ...runtime.paramValues,
      ...runtime.injectedValues,
      prompt,
      text: prompt,
    }
    const estimateParams: DynamicValueMap = {
      ...generationParams,
      ...(runtime.images.length > 0
        ? {
          images: runtime.images,
          uploadedFilePaths: runtime.images,
        }
        : {}),
    }
    const estimate = await GenerationService.getInstance().getProgressEstimate(
      runtime.modelId,
      estimateParams
    )
    if (!isGenerationProjectCurrent()) throw new Error('画布项目已切换，本次生成已停止')
    await execution.assertCurrent()
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
      generationSourceNodeId: id,
      generationInputSignature: execution.inputSignature,
      [STORYBOARD_GENERATION_RESUME_CONTEXT_FIELD]: runtime.resumeContext,
      prompt: '',
      modelId: runtime.modelId,
      params: { ...runtime.paramValues },
    })

    addEdge(id, newNodeId)
    setSelectedNode(null)
    setError(null)
    const taskLifecycle = createCanvasGenerationTaskLifecycle(
      isGenerationProjectCurrent,
      (taskId) => updateNodeData(newNodeId, { serverTaskId: taskId, serverTaskModelId: runtime.modelId }),
    )

    try {
      const generated = await generateStoryboardImage({
        modelId: runtime.modelId,
        params: generationParams,
        incomingImages: runtime.images,
        frameAspectRatioValue: runtime.frameAspectRatio,
        resumeContext: runtime.resumeContext,
        gridImageResolution: runtime.gridResolution,
        onProgress: (progress) => {
          if (isGenerationProjectCurrent()) setNodeGenerationProgress(newNodeId, progress)
        },
        onTaskId: taskLifecycle.onTaskId,
        assertCurrent: execution.assertCurrent,
      })

      if (!isGenerationProjectCurrent()) {
        await taskLifecycle.cancelLatest()
        throw new Error('画布项目已切换，本次生成结果已丢弃')
      }

      const committed = await commitCanvasGenerationOutputs({
        sourceNodeId: id,
        placeholderNodeId: newNodeId,
        resultNodeType: CANVAS_NODE_TYPES.exportImage,
        contract: generated.contract,
        completionId: `storyboard-grid:${newNodeId}`,
        groupTitle: `${resolvedTitle} · ${generated.contract.outputs.length}`,
      })
      return { status: committed.idempotent ? 'reused' : 'completed', resultNodeIds: committed.resultNodeIds }
    } catch (generationError) {
      if (isGenerationProjectCurrent()) {
        updateNodeData(newNodeId, {
          isGenerating: false,
          generationStartedAt: null,
          generationError:
            generationError instanceof Error ? generationError.message : '生成失败',
          serverTaskId: null,
          serverTaskModelId: null,
        })
      }
      throw generationError
    } finally {
      taskLifecycle.release()
      if (isGenerationProjectCurrent()) setNodeGenerationProgress(newNodeId, null)
    }
  }, [addEdge, addNode, findNodePosition, id, resolvedTitle, setNodeGenerationProgress, setSelectedNode, t, updateNodeData])

  const preflightBeforeDependencies = useCallback((execution: CanvasNodePreflightContext) => {
    if (
      execution.projectId
      && !isCanvasProjectContextCurrent(execution.projectId)
    ) throw new Error('画布项目已切换，本次生成已停止')
    const runtime = resolveStoryboardExecutionInput(id)
    if (
      !runtime.model
      || !STORYBOARD_IMAGE_EDIT_REQUIRED_TAGS.every((tag) => runtime.model?.meta.tags?.includes(tag))
    ) throw new Error('当前模型不支持分镜图生图')
    if (runtime.providerConfigured) return
    showAlertDialog({
      title: t('common:providerKeyRequired.title'),
      message: t('common:providerKeyRequired.message'),
      type: 'info',
      settingsTarget: { tab: 'models', sectionId: 'models-providers' },
    })
    throw new Error(t('common:providerKeyRequired.message'))
  }, [id, t])

  useEffect(() => registerCanvasNodeExecutor(id, {
    kind: 'storyboard-generation',
    dependency: { mode: 'auto', outputMode: 'result-nodes' },
    getInputSignatureExtras: getStoryboardExecutionSignatureExtras,
    preflightBeforeDependencies,
    run: handleGenerate,
  }), [handleGenerate, id, preflightBeforeDependencies])

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
              requiredTags={STORYBOARD_IMAGE_EDIT_REQUIRED_TAGS}
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
