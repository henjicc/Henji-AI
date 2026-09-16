import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { useProjectStore } from '@/stores/projectStore';
import { attachCanvasGenerationFeedback } from '../application/canvasDomainExecutors';
import { ICON_NODE_STORYBOARD } from '@/core/theme/icons';

import { CANVAS_NODE_TYPES, DEFAULT_ASPECT_RATIO, type StoryboardGenNodeData } from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { getDefaultModelId } from '@/features/canvas/domain/defaultModels';
import { getSocketColor, MODEL_PARAM_ID } from '@/features/canvas/domain/socketTypes';
import { areMediaOutputListsEqual, collectInputMediaByKind } from '@/features/canvas/application/graphMediaResolver';
import { areStringSetsEqual, areValueOverridesEqual, collectInputValues, getConnectedParamIds } from '@/features/canvas/application/graphValueResolver';
import { useStoreWithEqualityFn } from 'zustand/traditional';
import { useNodeModelParams } from '@/features/canvas/params/useNodeModelParams';
import { ModelInputRow } from '@/features/canvas/params/ModelInputRow';
import { MediaInputRow } from '@/features/canvas/params/MediaInputRow';
import { NodeParamRows } from '@/features/canvas/params/NodeParamRows';
import { isParamVisible } from '@/components/params/paramVisibility';
import { resolveInputLimits } from '@/core/inputs/inputLimits';
import { registry } from '@/core/ModelRegistry';
import { analyzeRatioResolutionParams } from '@/core/params/ratioResolution';
import { transferModelParamOverridesBetweenModels } from '@/core/params/modelParamTransfer';

import { useCanvasStore } from '@/stores/canvasStore';
import { showAlertDialog } from '@/stores/alertDialogStore';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeLodPlaceholder } from '@/features/canvas/ui/NodeLodPlaceholder';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import { NODE_IDLE_BORDER_CLASS, NODE_PORT_NODE_CLASS, NODE_PORT_VISIBLE_CLASS, NODE_ROW_GAP_CLASS, NODE_SELECTED_BORDER_CLASS } from '@/features/canvas/ui/nodeControlStyles';
import PriceEstimate from '@/components/ui/PriceEstimate';
import { STORYBOARD_GEN_ICON_ADJUST, generateFrameId } from '@/features/canvas/nodes/storyboardGen/shared';
import { computeStoryboardBaseFrameLayout, computeStoryboardFrameLayout } from '@/features/canvas/nodes/storyboardGen/layout';

import { STORYBOARD_IMAGE_EDIT_REQUIRED_TAGS } from '@/features/canvas/application/storyboardExecutionInput';





import { isNineGridStoryboard, NINE_GRID_PRESET_ID } from '@/features/canvas/capabilities/nineGridPolicy';
import { StoryboardGridEditor } from '@/features/canvas/nodes/storyboardGen/StoryboardGridEditor';
import { useStoryboardFramePrompts } from '@/features/canvas/nodes/storyboardGen/useStoryboardFramePrompts';


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
  const hasSourceConnections = useCanvasStore((state) =>
    state.edges.some((edge) => edge.source === id)
  )

  const nodeData = data as StoryboardGenNodeData
  const nineGridPreset = isNineGridStoryboard(nodeData)
  const [error, setError] = useState<string | null>(null)
  const projectId = useProjectStore(state => state.currentProjectId)
  useEffect(() => projectId ? attachCanvasGenerationFeedback(projectId, id, () => undefined, () => showAlertDialog({
    title: t('common:providerKeyRequired.title'), message: t('common:providerKeyRequired.message'),
    type: 'info', settingsTarget: { tab: 'models', sectionId: 'models-providers' },
  }), setError) : undefined, [projectId, id, t])
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
