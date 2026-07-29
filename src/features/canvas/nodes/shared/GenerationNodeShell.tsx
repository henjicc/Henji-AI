import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStoreWithEqualityFn } from 'zustand/traditional';

import {
  CANVAS_NODE_TYPES,
  EXPORT_RESULT_NODE_DEFAULT_WIDTH,
  EXPORT_RESULT_NODE_LAYOUT_HEIGHT,
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
  type RowMediaKind,
} from '@/features/canvas/domain/socketTypes';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeLodPlaceholder } from '@/features/canvas/ui/NodeLodPlaceholder';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import {
  NODE_IDLE_BORDER_CLASS,
  NODE_PORT_NODE_CLASS,
  NODE_PORT_VISIBLE_CLASS,
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
import { runCanvasGeneration } from '@/features/canvas/generation/runGeneration';
import { persistGenerationResult } from '@/features/canvas/generation/mediaResultPersist';
import { toModelPromptText } from '@/core/inputs/promptDocument';
import { transferModelParamOverridesBetweenModels } from '@/core/params/modelParamTransfer';
import { NodeInputRows } from '@/features/canvas/params/NodeInputRows';
import { useNodeModelParams } from '@/features/canvas/params/useNodeModelParams';
import { registry } from '@/core/ModelRegistry';
import { GenerationService } from '@/core/services/GenerationService';
import { canvasEventBus } from '@/features/canvas/application/canvasServices';
import PriceEstimate from '@/components/ui/PriceEstimate';
import { GenerationPromptEditor } from './GenerationPromptEditor';
import {
  useGenerationPromptDocument,
  type GenerationNodeShellData,
} from './useGenerationPromptDocument';
import { useGenerationNodeMinimumHeight } from './useGenerationNodeMinimumHeight';
import { useCanvasGenerationProgressStore } from '@/stores/canvasGenerationProgressStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { showAlertDialog } from '@/stores/alertDialogStore';

const DEFAULT_GENERATION_DURATION_MS = 60_000;
const RESULT_TITLE_MAX_CHARS = 10;
/** prompt/text 由结构化提示词编辑器单独渲染，不进入逐行参数区 */
const PROMPT_PARAM_IDS = ['prompt', 'text'];
const ROW_MEDIA_KINDS: RowMediaKind[] = ['image', 'video', 'audio'];

export type { GenerationNodeShellData } from './useGenerationPromptDocument';

export interface GenerationNodeShellProps {
  id: string;
  nodeType: CanvasNodeType;
  data: GenerationNodeShellData;
  selected?: boolean;
  width?: number;
  height?: number;
  icon?: ReactNode;
  /** i18n 键：提示词占位/必填提示/无 API Key 提示/结果节点默认标题 */
  promptPlaceholderKey: string;
  promptRequiredKey: string;
  apiKeyRequiredKey: string;
  resultTitleKey: string;
  /** 结果节点的附加初始数据（如 resultKind） */
  resultNodeExtraData?: DynamicValueMap;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
}

function buildResultNodeTitle(prompt: string, fallbackTitle: string): string {
  const normalizedPrompt = prompt.trim();
  if (!normalizedPrompt) {
    return fallbackTitle;
  }
  if (normalizedPrompt.length <= RESULT_TITLE_MAX_CHARS) {
    return normalizedPrompt;
  }
  return `${normalizedPrompt.slice(0, RESULT_TITLE_MAX_CHARS)}...`;
}

/**
 * 生成类节点通用壳：标题 + 提示词输入（@引用）+ 逐行输入区（媒体/参数/模型）+ 端口。
 * 生成行为由 nodeRegistry 中该节点类型的 generation/ports 声明驱动；
 * 生成动作由顶部工具条触发（见 NodeActionToolbar），通过 canvasEventBus 'generation/run' 事件转发到此处。
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
  const setNodeGenerationProgress = useCanvasGenerationProgressStore((state) => state.setProgress);
  const addNode = useCanvasStore((state) => state.addNode);
  const findNodePosition = useCanvasStore((state) => state.findNodePosition);
  const addEdge = useCanvasStore((state) => state.addEdge);
  const providerKeyStatus = useSettingsStore((state) => state.providerKeyStatus);
  const hasSourceConnections = useCanvasStore(
    (state) => getMainPortConnectionFlags(state.edges).get(id)?.hasMainSource ?? false
  );

  const definition = useMemo(() => getNodeDefinition(nodeType), [nodeType]);
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

  // 裁剪窗口选中的 [start, end] 只是附加在视频引用上的元数据，不替换 mediaInputs.video——
  // 完整视频始终保留，重新打开裁剪窗口可以在完整时长范围内重新选择。
  const videoTrimRange = useMemo(
    () => (
      typeof data.videoTrimStart === 'number' && typeof data.videoTrimEnd === 'number'
        ? { start: data.videoTrimStart, end: data.videoTrimEnd }
        : null
    ),
    [data.videoTrimStart, data.videoTrimEnd]
  );
  const handleVideoTrimRangeChange = useCallback((range: { start: number; end: number }) => {
    updateNodeData(id, { videoTrimStart: range.start, videoTrimEnd: range.end });
  }, [id, updateNodeData]);

  // 换了一个视频（节点切换了引用，不只是同一个视频重新拖了选区）时清空裁剪选区，
  // 对齐对话面板"换视频重置选区"的逻辑。
  const primaryVideoRef = useRef<string | null>(null);
  useEffect(() => {
    const primaryVideo = effectiveVideos[0] ?? null;
    if (primaryVideoRef.current !== null && primaryVideoRef.current !== primaryVideo && (data.videoTrimStart !== undefined || data.videoTrimEnd !== undefined)) {
      updateNodeData(id, { videoTrimStart: undefined, videoTrimEnd: undefined });
    }
    primaryVideoRef.current = primaryVideo;
  }, [effectiveVideos, data.videoTrimStart, data.videoTrimEnd, id, updateNodeData]);

  const selectedModelId = useMemo(() => {
    const stored = typeof data.modelId === 'string' ? data.modelId.trim() : '';
    if (stored && registry.getModel(stored)) {
      return stored;
    }
    return getDefaultModelId(modelType);
  }, [data.modelId, modelType]);
  const effectiveModelId = overrideModelId ?? selectedModelId;
  const effectiveModel = useMemo(() => registry.getModel(effectiveModelId), [effectiveModelId]);
  const providerKeyConfigured = effectiveModel
    ? providerKeyStatus[effectiveModel.meta.provider] === true
    : false;

  const handleParamsChange = useCallback((nextParams: DynamicValueMap, options?: { historyGroup?: string }) => {
    updateNodeData(id, { params: nextParams }, options);
  }, [id, updateNodeData]);

  const { schema, values: modelParamValues, setParam } = useNodeModelParams({
    modelId: effectiveModelId,
    storedParams: data.params,
    onParamsChange: handleParamsChange,
    media: { images: effectiveImages, videos: effectiveVideos, audios: effectiveAudios },
  });

  const handleModelChange = useCallback((nextModelId: string) => {
    const transferredParams = transferModelParamOverridesBetweenModels(
      effectiveModelId,
      nextModelId,
      modelParamValues,
    );
    updateNodeData(id, {
      modelId: nextModelId,
      params: transferredParams,
    });
  }, [effectiveModelId, id, modelParamValues, updateNodeData]);

  const resolvedTitle = useMemo(
    () => resolveNodeDisplayName(nodeType, data as CanvasNodeData),
    [data, nodeType]
  );
  const {
    rootRef,
    inputRowsRef,
    minimumHeight: resolvedMinimumHeight,
  } = useGenerationNodeMinimumHeight(minHeight);
  // 未手动 resize 时按内容自适应宽度；手动调整后使用用户尺寸并受 min/max 约束。
  const hasManualWidth = typeof width === 'number' && Number.isFinite(width);
  const resolvedWidth = hasManualWidth ? Math.max(minWidth, Math.round(width)) : null;
  // 提示词正文长度不参与最低高度，否则长文本会反向锁死 NodeResizeControl。
  const resolvedHeight = typeof height === 'number' && Number.isFinite(height)
    ? Math.max(resolvedMinimumHeight, Math.round(height))
    : resolvedMinimumHeight;

  useEffect(() => {
    if (data.modelId !== selectedModelId) {
      updateNodeData(id, { modelId: selectedModelId });
    }
  }, [data.modelId, id, selectedModelId, updateNodeData]);

  const handleGenerate = useCallback(async () => {
    const prompt = toModelPromptText(effectivePromptDocument, { references: promptReferences }).trim();
    if (!prompt) {
      setPromptInvalid(true);
      return;
    }
    setPromptInvalid(false);

    // 缺 API Key 是"还没开始生成"的前置失败，不建输出节点；
    // 它有明确的补救动作，所以走带「去设置」的统一弹窗
    if (!providerKeyConfigured) {
      showAlertDialog({
        title: t('common:error'),
        message: t(apiKeyRequiredKey),
        type: 'warning',
        settingsTarget: { tab: 'api', sectionId: 'api-keys' },
      });
      return;
    }

    // 连线注入的标量值优先覆盖内联值（数值/源节点 → 参数端口）
    const { nodes: graphNodes, edges: graphEdges } = useCanvasStore.getState();
    const injectedParamValues = collectInputValues(id, graphNodes, graphEdges);
    const generationParams: DynamicValueMap = {
      ...modelParamValues,
      ...injectedParamValues,
      prompt,
      text: prompt,
      // 裁剪窗口选中的 [start, end]（若用户裁剪过）；GenerationService 在生成提交时
      // 用它对完整视频做一次快速裁剪，不在这里提前处理
      ...(typeof data.videoTrimStart === 'number' ? { uploadedVideoTrimStart: data.videoTrimStart } : {}),
      ...(typeof data.videoTrimEnd === 'number' ? { uploadedVideoTrimEnd: data.videoTrimEnd } : {}),
    };
    const estimateParams: DynamicValueMap = {
      ...generationParams,
      ...(effectiveImages.length > 0
        ? { images: effectiveImages, uploadedFilePaths: effectiveImages }
        : {}),
      ...(effectiveVideos.length > 0
        ? { videos: effectiveVideos, uploadedVideoFilePaths: effectiveVideos }
        : {}),
    };
    const estimate = await GenerationService.getInstance().getProgressEstimate(
      effectiveModelId,
      estimateParams
    );
    const generationDurationMs = estimate?.durationMs ?? DEFAULT_GENERATION_DURATION_MS;
    const generationStartedAt = Date.now();
    const resultNodeTitle = buildResultNodeTitle(prompt, t(resultTitleKey));

    const newNodePosition = findNodePosition(
      id,
      EXPORT_RESULT_NODE_DEFAULT_WIDTH,
      EXPORT_RESULT_NODE_LAYOUT_HEIGHT
    );
    const newNodeId = addNode(
      resultNodeType,
      newNodePosition,
      {
        isGenerating: true,
        generationStartedAt,
        generationDurationMs,
        displayName: resultNodeTitle,
        ...(resultNodeExtraData ?? {}),
      }
    );
    addEdge(id, newNodeId);

    try {
      const result = await runCanvasGeneration({
        modelId: effectiveModelId,
        mediaType: modelType,
        params: generationParams,
        upstream: {
          images: effectiveImages,
          videos: effectiveVideos,
          audios: effectiveAudios,
        },
        onProgress: (progress) => setNodeGenerationProgress(newNodeId, progress),
        // 任务一创建就落到节点上：这是应用中途退出后唯一能把这次生成找回来的凭据
        onTaskId: (taskId) => updateNodeData(newNodeId, {
          serverTaskId: taskId,
          serverTaskModelId: effectiveModelId,
        }),
      });

      const resultPatch = await persistGenerationResult(modelType, result.primary);
      updateNodeData(newNodeId, {
        ...resultPatch,
        isGenerating: false,
        generationStartedAt: null,
        generationError: null,
        serverTaskId: null,
        serverTaskModelId: null,
      });
    } catch (generationError) {
      // 失败信息写回输出节点：失败的是那次生成，红边和原因就应该长在它自己身上，
      // 而不是回头挂在发起节点的底部（那里既看不出对应哪次生成，也会把节点撑变形）
      updateNodeData(newNodeId, {
        isGenerating: false,
        generationStartedAt: null,
        generationError:
          generationError instanceof Error ? generationError.message : t('ai.error'),
        serverTaskId: null,
        serverTaskModelId: null,
      });
    } finally {
      setNodeGenerationProgress(newNodeId, null);
    }
  }, [addEdge, addNode, apiKeyRequiredKey, data.videoTrimEnd, data.videoTrimStart, effectiveAudios, effectiveImages, effectiveModelId, effectivePromptDocument, effectiveVideos, findNodePosition, id, modelParamValues, modelType, promptReferences, providerKeyConfigured, resultNodeExtraData, resultNodeType, resultTitleKey, setNodeGenerationProgress, t, updateNodeData]);

  useEffect(() => canvasEventBus.subscribe('generation/run', ({ nodeId }) => {
    if (nodeId !== id) {
      return;
    }
    void handleGenerate();
  }), [handleGenerate, id]);

  return (
    <div
      ref={rootRef}
      className={`
        canvas-node-dynamic-min-height group relative flex flex-col overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/90 p-2 transition-colors duration-150
        ${selected
          ? NODE_SELECTED_BORDER_CLASS
          : NODE_IDLE_BORDER_CLASS}
      `}
      style={{
        width: resolvedWidth !== null ? `${resolvedWidth}px` : 'max-content',
        minWidth: `${minWidth}px`,
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

      {/* 数值型下限由参数区实高计算；长提示词只占剩余空间并在内部滚动。 */}
      <div className="canvas-node-lod-detail relative flex min-h-0 flex-1 flex-col gap-1.5">
        {/* 提示词区是唯一的伸缩项：节点拉高多出来的空间全部由它吸收，下方各行保持原高与行距 */}
        <GenerationPromptEditor
          nodeId={id}
          selected={Boolean(selected)}
          value={effectivePromptDocument}
          references={promptReferences}
          readOnly={isPromptOverridden}
          invalid={promptInvalid}
          // 漏填时把“请输入提示词”直接顶到空框里当占位，比在节点底部加一行红字更省空间
          placeholder={promptInvalid ? t(promptRequiredKey) : t(promptPlaceholderKey)}
          onChange={handlePromptChange}
          onSubmit={() => {
            void handleGenerate();
          }}
          onEditEnd={promptState.onEditEnd}
          onSelectNode={setSelectedNode}
        />

        <div ref={inputRowsRef} className="shrink-0">
          <NodeInputRows
            nodeId={id}
            modelId={effectiveModelId}
            mediaType={modelType}
            acceptedMediaKinds={acceptedMediaKinds}
            schema={schema}
            values={modelParamValues}
            setParam={setParam}
            excludeParamIds={PROMPT_PARAM_IDS}
            mediaInputs={mediaInputs}
            onMediaInputChange={handleMediaInputChange}
            overrideModelId={overrideModelId}
            storedParams={data.params}
            onModelChange={handleModelChange}
            onParamsChange={handleParamsChange}
            incomingImages={effectiveImages}
            videoTrimRange={videoTrimRange}
            onVideoTrimRangeChange={handleVideoTrimRangeChange}
          />
        </div>
      </div>
      <Handle
        type="source"
        id="source"
        position={Position.Right}
        className={`${NODE_PORT_NODE_CLASS} ${hasSourceConnections ? NODE_PORT_VISIBLE_CLASS : ''}`}
        style={{ background: getSocketColor(modelType.toUpperCase()), right: 0, top: '50%', transform: 'translate(50%, -50%)' }}
      />
      <NodeResizeHandle
        minWidth={minWidth}
        minHeight={resolvedMinimumHeight}
        maxWidth={maxWidth}
        maxHeight={maxHeight}
      />
    </div>
  );
});

GenerationNodeShell.displayName = 'GenerationNodeShell';
