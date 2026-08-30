import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStoreWithEqualityFn } from 'zustand/traditional';

import {
  CANVAS_NODE_TYPES,
  type CanvasNodeData,
  type CanvasNodeType,
} from '@/features/canvas/domain/canvasNodes';
import { getMainPortConnectionFlags } from '@/features/canvas/domain/connectionIndex';
import { getDefaultModelId } from '@/features/canvas/domain/defaultModels';
import { getNodeDefinition } from '@/features/canvas/domain/nodeRegistry';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import {
  MODEL_PARAM_ID,
  PROMPT_PARAM_ID,
  getSocketColor,
} from '@/features/canvas/domain/socketTypes';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeLodPlaceholder } from '@/features/canvas/ui/NodeLodPlaceholder';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import {
  NODE_IDLE_BORDER_CLASS,
  NODE_PORT_NODE_CLASS,
  NODE_PORT_VISIBLE_CLASS,
  NODE_ROW_GAP_CLASS,
  NODE_SELECTED_BORDER_CLASS,
} from '@/features/canvas/ui/nodeControlStyles';
import {
  areMediaOutputListsEqual,
  collectInputMedia,
} from '@/features/canvas/application/graphMediaResolver';
import {
  areStringSetsEqual,
  areValueOverridesEqual,
  collectInputValues,
  getConnectedParamIds,
} from '@/features/canvas/application/graphValueResolver';
import { transferModelParamOverridesBetweenModels } from '@/core/params/modelParamTransfer';
import { NodeInputRows } from '@/features/canvas/params/NodeInputRows';
import { useNodeModelParams } from '@/features/canvas/params/useNodeModelParams';
import { registry } from '@/core/ModelRegistry';
import { runCanvasNode } from '@/features/canvas/application/canvasExecutionService';
import PriceEstimate from '@/components/ui/PriceEstimate';
import { GenerationPromptEditor } from './GenerationPromptEditor';
import { useGenerationPromptDocument } from './useGenerationPromptDocument';
import {
  resolveGenerationNodeManualDimension,
  useGenerationNodeMinimumHeight,
} from './useGenerationNodeMinimumHeight';
import { useCanvasStore } from '@/stores/canvasStore';
import { PROMPT_PARAM_IDS, ROW_MEDIA_KINDS } from './generationNodeGuards';
import { useNodeVideoTrimRange } from './useNodeVideoTrimRange';
import {
  getCanvasImageCapability,
  prepareCanvasCapabilityGeneration,
  resolveCanvasCapabilityModelCandidates,
  resolveCanvasCapabilityVisibleParamIds,
  resolveCanvasCapabilityPromptTemplateVersion,
} from '@/features/canvas/capabilities';
import { useGenerationNodeExecution } from './useGenerationNodeExecution';
import { ToolWorkbenchSourcePreview } from './ToolWorkbenchNodeFrame';
import type { GenerationNodeShellProps } from './generationNodeShellTypes';

export type { GenerationNodeShellData } from './useGenerationPromptDocument';
export type {
  GenerationNodeRequestPreparation,
  GenerationNodeResultCommitContext,
  GenerationNodeResultCommitResult,
  GenerationNodeRuntimePreparationContext,
} from './generationNodeExecutionTypes';
export type { GenerationNodeShellProps, GenerationNodeWorkbenchContext } from './generationNodeShellTypes';

/**
 * 生成类节点通用壳：标题 + 提示词输入（@引用）+ 逐行输入区（媒体/参数/模型）+ 端口。
 * 生成行为由 nodeRegistry 中该节点类型的 generation/ports 声明驱动；
 * 生成动作由顶部工具条触发（见 NodeActionToolbar），统一交给画布运行协调器处理上游依赖。
 */
export const GenerationNodeShell = memo(({
  id,
  nodeType,
  data,
  selected,
  width,
  height,
  icon,
  promptPlaceholderKey,
  promptRequiredKey,
  apiKeyRequiredKey,
  resultTitleKey,
  resultNodeExtraData,
  capabilityId,
  showPromptInput = true,
  requirePrompt = true,
  promptMaxCharacters,
  showModelInput = true,
  excludeParamIds,
  prepareRuntimeParams,
  prepareGenerationRequest,
  commitGenerationResult,
  additionalInputRows,
  layoutMode = 'stacked',
  workbenchStage,
  workbenchSummary,
  minWidth = 320,
  minHeight = 160,
  maxWidth = 1400,
  maxHeight = 1000,
}: GenerationNodeShellProps) => {
  const { t } = useTranslation();
  // 提示词漏填只把输入框标红（视线本来就在这儿），不弹窗也不占用节点高度
  const [promptInvalid, setPromptInvalid] = useState(false);

  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const hasSourceConnections = useCanvasStore(
    (state) => getMainPortConnectionFlags(state.edges).get(id)?.hasMainSource ?? false
  );

  const definition = useMemo(() => getNodeDefinition(nodeType), [nodeType]);
  const capability = useMemo(
    () => capabilityId ? getCanvasImageCapability(capabilityId) : null,
    [capabilityId],
  );
  const generationSpec = definition.generation;
  const modelType = generationSpec?.modelType ?? 'image';
  const resultNodeType = (generationSpec?.resultNodeType ?? CANVAS_NODE_TYPES.exportImage) as CanvasNodeType;
  const acceptedKinds = useMemo(
    () => definition.ports?.target?.accepts ?? [],
    [definition]
  );
  const acceptedMediaKinds = useMemo(
    () => ROW_MEDIA_KINDS.filter((kind) => acceptedKinds.includes(kind)),
    [acceptedKinds]
  );

  const connectedParamIds = useStoreWithEqualityFn(
    useCanvasStore,
    (state) => getConnectedParamIds(id, state.edges),
    areStringSetsEqual
  );
  const injectedValues = useStoreWithEqualityFn(
    useCanvasStore,
    (state) => collectInputValues(id, state.nodes, state.edges),
    areValueOverridesEqual
  );
  const isModelOverridden = connectedParamIds.has(MODEL_PARAM_ID);
  const overrideModelId = isModelOverridden && typeof injectedValues[MODEL_PARAM_ID] === 'string'
    ? injectedValues[MODEL_PARAM_ID] as string
    : null;
  const isPromptOverridden = connectedParamIds.has(PROMPT_PARAM_ID);
  const promptOverrideValue = isPromptOverridden && typeof injectedValues[PROMPT_PARAM_ID] === 'string'
    ? injectedValues[PROMPT_PARAM_ID] as string
    : null;

  // 内容相等比较的细粒度订阅：仅在上游媒体实际变化时重渲染，避免全画布节点联动刷新
  const incomingMedia = useStoreWithEqualityFn(
    useCanvasStore,
    (state) => collectInputMedia(id, state.nodes, state.edges)
      .filter((output) => acceptedKinds.includes(output.kind)),
    areMediaOutputListsEqual
  );
  const mediaInputs = useMemo(() => data.mediaInputs ?? {}, [data.mediaInputs]);
  const handleValidPromptContent = useCallback(() => setPromptInvalid(false), []);
  const promptState = useGenerationPromptDocument({
    nodeId: id,
    data,
    mediaInputs,
    incomingMedia,
    acceptedMediaKinds,
    isPromptOverridden,
    promptOverrideValue,
    invalid: promptInvalid,
    onValidContent: handleValidPromptContent,
  });
  const effectiveImages = promptState.mediaUrls.image;
  const effectiveVideos = promptState.mediaUrls.video;
  const effectiveAudios = promptState.mediaUrls.audio;
  const effectivePromptDocument = promptState.document;
  const promptReferences = promptState.references;
  const handlePromptChange = promptState.handleChange;
  const handleMediaInputChange = promptState.handleMediaInputChange;

  const { videoTrimRange, handleVideoTrimRangeChange } = useNodeVideoTrimRange({
    nodeId: id,
    videos: effectiveVideos,
    start: data.videoTrimStart,
    end: data.videoTrimEnd,
  });

  const selectedModelId = useMemo(() => {
    const stored = typeof data.modelId === 'string' ? data.modelId.trim() : '';
    const compatibleIds = capability
      ? new Set(resolveCanvasCapabilityModelCandidates(
        registry.getModelsByType(modelType),
        capability.modelPolicy,
      ).candidates.map(({ model }) => model.meta.id))
      : null;
    if (stored && registry.getModel(stored) && (!compatibleIds || compatibleIds.has(stored))) {
      return stored;
    }
    if (compatibleIds) {
      const defaultModelId = getDefaultModelId(modelType);
      if (compatibleIds.has(defaultModelId)) return defaultModelId;
      return compatibleIds.values().next().value ?? defaultModelId;
    }
    return getDefaultModelId(modelType);
  }, [capability, data.modelId, modelType]);
  const effectiveModelId = showModelInput ? (overrideModelId ?? selectedModelId) : selectedModelId;
  const effectiveModel = useMemo(() => registry.getModel(effectiveModelId), [effectiveModelId]);
  const handleParamsChange = useCallback((nextParams: DynamicValueMap, options?: { historyGroup?: string }) => {
    updateNodeData(id, { params: nextParams }, options);
  }, [id, updateNodeData]);

  const { schema, values: modelParamValues, setParam, setParams } = useNodeModelParams({
    modelId: effectiveModelId,
    storedParams: data.params,
    onParamsChange: handleParamsChange,
    media: { images: effectiveImages, videos: effectiveVideos, audios: effectiveAudios },
  });
  const visibleCapabilityParamIds = useMemo(() => {
    if (!capability) return undefined;
    if (!effectiveModel) return [...capability.promptPolicy.visibleParameterKeys];
    return resolveCanvasCapabilityVisibleParamIds(
      effectiveModel,
      capability.modelPolicy,
      capability.promptPolicy,
    );
  }, [capability, effectiveModel]);
  const excludedSchemaParamIds = useMemo(
    () => [...new Set([...PROMPT_PARAM_IDS, ...(excludeParamIds ?? [])])],
    [excludeParamIds],
  );

  const handleModelChange = useCallback((nextModelId: string) => {
    const transferredParams = transferModelParamOverridesBetweenModels(
      effectiveModelId,
      nextModelId,
      modelParamValues,
    );
    const nextModel = registry.getModel(nextModelId);
    const nextParams = capability && nextModel
      ? prepareCanvasCapabilityGeneration({
        capability,
        model: nextModel,
        currentParams: transferredParams,
        userPrompt: '',
        referenceImageCount: effectiveImages.length,
      }).params
      : transferredParams;
    updateNodeData(id, {
      modelId: nextModelId,
      params: nextParams,
    });
  }, [capability, effectiveImages.length, effectiveModelId, id, modelParamValues, updateNodeData]);

  const resolvedTitle = useMemo(
    () => resolveNodeDisplayName(nodeType, data as CanvasNodeData),
    [data, nodeType]
  );
  const resolvedMinWidth = layoutMode === 'workbench' ? Math.max(640, minWidth) : minWidth;
  const resolvedMinHeight = layoutMode === 'workbench' ? Math.max(300, minHeight) : minHeight;
  const {
    rootRef,
    inputRowsRef,
    minimumHeight: resolvedMinimumHeight,
  } = useGenerationNodeMinimumHeight(resolvedMinHeight);
  // ReactFlow 的 width/height 同时包含内容测量值。只有用户拖拽过尺寸后才沿用，
  // 避免旧版参数组内联展开产生的测量高度在收起后继续把节点撑大。
  const isSizeManuallyAdjusted = data.isSizeManuallyAdjusted === true;
  const resolvedWidth = resolveGenerationNodeManualDimension(
    width,
    resolvedMinWidth,
    isSizeManuallyAdjusted,
  );
  // 提示词正文长度不参与最低高度，否则长文本会反向锁死 NodeResizeControl。
  const resolvedHeight = resolveGenerationNodeManualDimension(
    height,
    resolvedMinimumHeight,
    isSizeManuallyAdjusted,
  ) ?? resolvedMinimumHeight;

  useEffect(() => {
    if (data.modelId !== selectedModelId) {
      updateNodeData(id, { modelId: selectedModelId });
    }
  }, [data.modelId, id, selectedModelId, updateNodeData]);

  const activePromptTemplateVersion = capability
    ? resolveCanvasCapabilityPromptTemplateVersion(
      capability.promptPolicy,
      effectiveImages.length,
    )
    : null;
  const capabilityReferenceImageMax = capability?.modelPolicy.mode === 'verified-families'
    ? capability.modelPolicy.semanticRequirements.referenceImages?.max
    : undefined;

  useEffect(() => {
    if (!capability) return;
    if (
      data.capabilityId === capability.id
      && data.promptTemplateVersion === activePromptTemplateVersion
    ) return;
    updateNodeData(id, {
      capabilityId: capability.id,
      promptTemplateVersion: activePromptTemplateVersion,
      fixedSemanticParams: { ...capability.promptPolicy.fixedSemanticParams },
    }, { skipHistory: true });
  }, [activePromptTemplateVersion, capability, data.capabilityId, data.promptTemplateVersion, id, updateNodeData]);

  useGenerationNodeExecution({
    nodeId: id,
    modelType,
    resultNodeType,
    acceptedKinds,
    acceptedMediaKinds,
    capability,
    showModelInput,
    requirePrompt,
    promptRequiredKey,
    apiKeyRequiredKey,
    resultTitleKey,
    resultNodeExtraData,
    prepareRuntimeParams,
    prepareGenerationRequest,
    commitGenerationResult,
    setPromptInvalid,
    t,
  });

  const promptEditor = showPromptInput ? (
    <GenerationPromptEditor
      nodeId={id}
      selected={Boolean(selected)}
      value={effectivePromptDocument}
      references={promptReferences}
      readOnly={isPromptOverridden}
      invalid={promptInvalid}
      placeholder={promptInvalid ? t(promptRequiredKey) : t(promptPlaceholderKey)}
      maxCharacters={promptMaxCharacters}
      onChange={handlePromptChange}
      onSubmit={() => void runCanvasNode(id).catch(() => undefined)}
      onEditEnd={promptState.onEditEnd}
      onSelectNode={setSelectedNode}
    />
  ) : null;

  const inputRows = (
    <div
      ref={layoutMode === 'stacked' ? inputRowsRef : undefined}
      className={`flex shrink-0 flex-col ${NODE_ROW_GAP_CLASS}`}
    >
      <NodeInputRows
        nodeId={id}
        modelId={effectiveModelId}
        mediaType={modelType}
        acceptedMediaKinds={acceptedMediaKinds}
        schema={schema}
        values={modelParamValues}
        setParam={setParam}
        setParams={setParams}
        excludeParamIds={excludedSchemaParamIds}
        mediaInputs={mediaInputs}
        onMediaInputChange={handleMediaInputChange}
        overrideModelId={overrideModelId}
        storedParams={data.params}
        onModelChange={handleModelChange}
        onParamsChange={handleParamsChange}
        incomingImages={effectiveImages}
        modelPolicy={capability?.modelPolicy}
        showModelInput={showModelInput}
        maxMediaCounts={typeof capabilityReferenceImageMax === 'number'
          ? { image: capabilityReferenceImageMax }
          : undefined}
        visibleParamIds={visibleCapabilityParamIds}
        videoTrimRange={videoTrimRange}
        onVideoTrimRangeChange={handleVideoTrimRangeChange}
      />
      {additionalInputRows}
    </div>
  );
  const resolvedWorkbenchStage = typeof workbenchStage === 'function'
    ? workbenchStage({
        images: effectiveImages,
        videos: effectiveVideos,
        audios: effectiveAudios,
      })
    : workbenchStage;

  return (
    <div
      ref={rootRef}
      data-generation-node-id={id}
      data-generation-node-model-id={effectiveModelId}
      data-generation-node-layout={layoutMode}
      className={`
        canvas-node-dynamic-min-height group relative flex flex-col overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/90 p-2 transition-colors duration-150
        ${selected
          ? NODE_SELECTED_BORDER_CLASS
          : NODE_IDLE_BORDER_CLASS}
      `}
      style={{
        width: resolvedWidth !== null
          ? `${resolvedWidth}px`
          : layoutMode === 'workbench' ? `${resolvedMinWidth}px` : 'max-content',
        minWidth: `${resolvedMinWidth}px`,
        maxWidth: `${maxWidth}px`,
        height: `${resolvedHeight}px`,
        minHeight: `${resolvedMinimumHeight}px`,
      }}
      onClick={() => setSelectedNode(id)}
    >
      <NodeHeader
        className={`${NODE_HEADER_FLOATING_POSITION_CLASS} canvas-node-lod-detail`}
        icon={icon ?? <Sparkles className="h-4 w-4" />}
        titleText={resolvedTitle}
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

      <NodeLodPlaceholder title={resolvedTitle} icon={icon ?? <Sparkles className="h-6 w-6" />} />

      {layoutMode === 'workbench' ? (
        <div className="canvas-node-lod-detail grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1.35fr)_minmax(240px,0.65fr)] overflow-hidden rounded-lg bg-bg-dark/45">
          <main className="nodrag nowheel flex min-h-0 min-w-0 overflow-hidden">
            {resolvedWorkbenchStage ?? (
              <ToolWorkbenchSourcePreview
                source={effectiveImages[0] ?? null}
                alt={resolvedTitle}
                icon={icon ?? <Sparkles className="h-8 w-8" />}
                emptyText={t('node.mediaRow.image')}
                summary={workbenchSummary}
              />
            )}
          </main>
          <aside className="nodrag nowheel flex min-h-0 min-w-0 flex-col gap-1.5 overflow-y-auto border-l border-veil-subtle p-2">
            {promptEditor}
            {inputRows}
          </aside>
        </div>
      ) : (
        <div className="canvas-node-lod-detail relative flex min-h-0 flex-1 flex-col gap-1.5">
          {promptEditor}
          {inputRows}
        </div>
      )}
      <Handle
        type="source"
        id="source"
        position={Position.Right}
        className={`${NODE_PORT_NODE_CLASS} ${hasSourceConnections ? NODE_PORT_VISIBLE_CLASS : ''}`}
        style={{ background: getSocketColor(modelType.toUpperCase()), right: 0, top: '50%', transform: 'translate(50%, -50%)' }}
      />
      <NodeResizeHandle
        minWidth={resolvedMinWidth}
        minHeight={resolvedMinimumHeight}
        maxWidth={maxWidth}
        maxHeight={maxHeight}
      />
    </div>
  );
});

GenerationNodeShell.displayName = 'GenerationNodeShell';
