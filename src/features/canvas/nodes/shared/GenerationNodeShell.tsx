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
  promptPortId,
  type RowMediaKind,
} from '@/features/canvas/domain/socketTypes';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeLodPlaceholder } from '@/features/canvas/ui/NodeLodPlaceholder';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import {
  NODE_PORT_NODE_CLASS,
  NODE_PORT_ROW_CLASS,
  NODE_PORT_VISIBLE_CLASS,
  NODE_ROW_CARD_CLASS,
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
import { NodeInputRows } from '@/features/canvas/params/NodeInputRows';
import { useNodeModelParams } from '@/features/canvas/params/useNodeModelParams';
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import { stripReferenceAtPrefix } from '@/core/inputs/referenceTokens';
import { registry } from '@/core/ModelRegistry';
import { GenerationService } from '@/core/services/GenerationService';
import { canvasEventBus } from '@/features/canvas/application/canvasServices';
import { ReferenceTextarea } from '@/components/ui';
import PriceEstimate from '@/components/ui/PriceEstimate';
import { useCanvasStore } from '@/stores/canvasStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { showAlertDialog } from '@/stores/alertDialogStore';

const DEFAULT_GENERATION_DURATION_MS = 60_000;
const RESULT_TITLE_MAX_CHARS = 10;
/** prompt/text 由 ReferenceTextarea 单独渲染，不进入逐行参数区 */
const PROMPT_PARAM_IDS = ['prompt', 'text'];
const ROW_MEDIA_KINDS: RowMediaKind[] = ['image', 'video', 'audio'];

export interface GenerationNodeShellData {
  displayName?: string;
  prompt: string;
  modelId?: string;
  params?: DynamicValueMap;
  /** 媒体行未连线时的本地内联上传值 */
  mediaInputs?: Partial<Record<RowMediaKind, string[]>>;
  /** 视频裁剪窗口选中的范围（秒），仅是元数据，不替换 mediaInputs.video 里的完整视频引用 */
  videoTrimStart?: number;
  videoTrimEnd?: number;
  [key: string]: DynamicValue;
}

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

  const [promptDraft, setPromptDraft] = useState(() => data.prompt ?? '');
  const promptDraftRef = useRef(promptDraft);

  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const setNodeGenerationProgress = useCanvasStore((state) => state.setNodeGenerationProgress);
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

  // 内容相等比较的细粒度订阅：仅在上游媒体实际变化时重渲染，避免全画布节点联动刷新
  const incomingMedia = useStoreWithEqualityFn(
    useCanvasStore,
    (state) => collectInputMedia(id, state.nodes, state.edges)
      .filter((output) => acceptedKinds.includes(output.kind)),
    areMediaOutputListsEqual
  );
  const incomingImages = useMemo(
    () => incomingMedia.filter((item) => item.kind === 'image').map((item) => item.url),
    [incomingMedia]
  );
  const incomingVideos = useMemo(
    () => incomingMedia.filter((item) => item.kind === 'video').map((item) => item.url),
    [incomingMedia]
  );
  const incomingAudios = useMemo(
    () => incomingMedia.filter((item) => item.kind === 'audio').map((item) => item.url),
    [incomingMedia]
  );

  const mediaInputs = useMemo(() => data.mediaInputs ?? {}, [data.mediaInputs]);
  // 生效媒体 = 已连线则用上游，否则用节点上的本地内联上传（与各媒体行内部的双态逻辑一致）
  const effectiveImages = useMemo(
    () => (incomingImages.length > 0 ? incomingImages : (mediaInputs.image ?? [])),
    [incomingImages, mediaInputs]
  );
  const effectiveVideos = useMemo(
    () => (incomingVideos.length > 0 ? incomingVideos : (mediaInputs.video ?? [])),
    [incomingVideos, mediaInputs]
  );
  const effectiveAudios = useMemo(
    () => (incomingAudios.length > 0 ? incomingAudios : (mediaInputs.audio ?? [])),
    [incomingAudios, mediaInputs]
  );

  const handleMediaInputChange = useCallback((kind: RowMediaKind, next: string[]) => {
    updateNodeData(id, { mediaInputs: { ...mediaInputs, [kind]: next } });
  }, [id, mediaInputs, updateNodeData]);

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

  const incomingImageItems = useMemo(
    () =>
      effectiveImages.map((imageUrl, index) => ({
        id: `image-ref-${index}`,
        label: `图${index + 1}`,
        thumbnailSrc: resolveImageDisplayUrl(imageUrl),
      })),
    [effectiveImages]
  );

  // 模型端口覆盖：连上模型选择器节点后，节点内选择只读，生效模型以连线为准
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

  // 提示词端口覆盖：连上字符串/文本源节点后，提示词框只读展示该值
  const isPromptOverridden = connectedParamIds.has(PROMPT_PARAM_ID);
  const promptOverrideValue = isPromptOverridden && typeof injectedValues[PROMPT_PARAM_ID] === 'string'
    ? injectedValues[PROMPT_PARAM_ID] as string
    : null;

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

  const handleParamsChange = useCallback((nextParams: DynamicValueMap) => {
    updateNodeData(id, { params: nextParams });
  }, [id, updateNodeData]);

  const { schema, values: modelParamValues, setParam } = useNodeModelParams({
    modelId: effectiveModelId,
    storedParams: data.params,
    onParamsChange: handleParamsChange,
    media: { images: effectiveImages, videos: effectiveVideos, audios: effectiveAudios },
  });

  const handleModelChange = useCallback((nextModelId: string) => {
    updateNodeData(id, { modelId: nextModelId, params: {} });
  }, [id, updateNodeData]);

  const resolvedTitle = useMemo(
    () => resolveNodeDisplayName(nodeType, data as CanvasNodeData),
    [data, nodeType]
  );

  // 未手动拖拽过尺寸时 width/height 为 undefined（react-flow 仅在手动 resize 后才写入），
  // 此时按内容自适应宽度（CSS max-content），不再回退到一个固定像素默认值；
  // 手动调整过后则严格使用用户拖拽出的尺寸（仍受 min/max 约束）。
  const hasManualWidth = typeof width === 'number' && Number.isFinite(width);
  const resolvedWidth = hasManualWidth ? Math.max(minWidth, Math.round(width)) : null;
  // 高度同时用确定 height + min-height:fit-content 两条约束表达，缺一不可：
  // - 确定 height 让纵向拖拽和横向一样 1:1 跟手（只给 min-height 的话，
  //   拖拽在没超过内容自然高度前毫无反应，手感上像是被识别成了横向拖拽）
  // - min-height:fit-content 在 CSS 中优先级高于 height，兜住"拖得比内容还矮"的情况，
  //   节点自动撑回内容所需的最小高度，各行不会溢出到边框外
  const resolvedHeight = typeof height === 'number' && Number.isFinite(height)
    ? Math.max(minHeight, Math.round(height))
    : minHeight;

  useEffect(() => {
    const externalPrompt = data.prompt ?? '';
    if (externalPrompt !== promptDraftRef.current) {
      promptDraftRef.current = externalPrompt;
      setPromptDraft(externalPrompt);
    }
  }, [data.prompt]);

  const commitPromptDraft = useCallback((nextPrompt: string) => {
    promptDraftRef.current = nextPrompt;
    updateNodeData(id, { prompt: nextPrompt });
  }, [id, updateNodeData]);

  useEffect(() => {
    if (data.modelId !== selectedModelId) {
      updateNodeData(id, { modelId: selectedModelId });
    }
  }, [data.modelId, id, selectedModelId, updateNodeData]);

  const handleGenerate = useCallback(async () => {
    const prompt = stripReferenceAtPrefix(promptOverrideValue ?? promptDraft).trim();
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
      });

      const resultPatch = await persistGenerationResult(modelType, result.primary);
      updateNodeData(newNodeId, {
        ...resultPatch,
        isGenerating: false,
        generationStartedAt: null,
        generationError: null,
      });
    } catch (generationError) {
      // 失败信息写回输出节点：失败的是那次生成，红边和原因就应该长在它自己身上，
      // 而不是回头挂在发起节点的底部（那里既看不出对应哪次生成，也会把节点撑变形）
      updateNodeData(newNodeId, {
        isGenerating: false,
        generationStartedAt: null,
        generationError:
          generationError instanceof Error ? generationError.message : t('ai.error'),
      });
    } finally {
      setNodeGenerationProgress(newNodeId, null);
    }
  }, [addEdge, addNode, apiKeyRequiredKey, data.videoTrimEnd, data.videoTrimStart, effectiveAudios, effectiveImages, effectiveModelId, effectiveVideos, findNodePosition, id, modelParamValues, modelType, promptDraft, promptOverrideValue, providerKeyConfigured, resultNodeExtraData, resultNodeType, resultTitleKey, setNodeGenerationProgress, t, updateNodeData]);

  useEffect(() => canvasEventBus.subscribe('generation/run', ({ nodeId }) => {
    if (nodeId !== id) {
      return;
    }
    void handleGenerate();
  }), [handleGenerate, id]);

  return (
    <div
      className={`
        group relative flex flex-col overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/90 p-2 transition-colors duration-150
        ${selected
          ? 'border-accent shadow-[0_0_0_1px_rgba(59,130,246,0.32)]'
          : 'border-[rgba(255,255,255,0.22)] hover:border-[rgba(255,255,255,0.34)]'}
      `}
      style={{
        width: resolvedWidth !== null ? `${resolvedWidth}px` : 'max-content',
        minWidth: `${minWidth}px`,
        maxWidth: `${maxWidth}px`,
        height: `${resolvedHeight}px`,
        minHeight: 'fit-content',
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

      {/* 这里绝对不能加 min-h-0：它会把本层对内容最小尺寸的贡献归零，
          令根容器的 min-height:fit-content 算成 0，height 直接胜出，各行溢出到边框外。
          实测：加 min-h-0 时根高被钉在 160px 且溢出 162px，去掉后自动撑到 323px。 */}
      <div className="canvas-node-lod-detail relative flex flex-1 flex-col gap-1.5">
        {/* 提示词区是唯一的伸缩项：节点拉高多出来的空间全部由它吸收，下方各行保持原高与行距 */}
        <div className="group/row relative flex min-h-[100px] flex-1 flex-col">
          <Handle
            type="target"
            id={promptPortId()}
            position={Position.Left}
            style={{ background: getSocketColor('STRING'), left: 0, top: '50%', transform: 'translate(-50%, -50%)' }}
            className={`${NODE_PORT_ROW_CLASS} ${isPromptOverridden ? NODE_PORT_VISIBLE_CLASS : ''}`}
          />
          <div
            className={`flex min-h-0 flex-1 flex-col p-1.5 focus-within:border-accent/70 ${NODE_ROW_CARD_CLASS} ${promptInvalid ? '!border-red-500/70' : ''}`}
          >
            <ReferenceTextarea
              value={promptOverrideValue ?? promptDraft}
              onChange={(nextValue) => {
                setPromptDraft(nextValue);
                commitPromptDraft(nextValue);
                if (promptInvalid && nextValue.trim()) {
                  setPromptInvalid(false);
                }
              }}
              disabled={Boolean(promptOverrideValue)}
              references={incomingImageItems}
              onMouseDown={(event) => event.stopPropagation()}
              // 漏填时把"请输入提示词"直接顶到空框里当占位，比在节点底部加一行红字更省空间
              placeholder={promptInvalid ? t(promptRequiredKey) : t(promptPlaceholderKey)}
              submitShortcut="mod-enter"
              onSubmit={() => {
                void handleGenerate();
              }}
              className="relative flex min-h-[86px] flex-1 flex-col overflow-visible rounded-md"
              highlightLayerClassName="text-sm leading-6 text-text-dark"
              highlightContentClassName="min-h-full px-1.5 py-1"
              textareaClassName={`ui-scrollbar nodrag nowheel !border-0 !bg-transparent !shadow-none relative z-10 min-h-[86px] w-full flex-1 resize-none overflow-y-auto overflow-x-hidden !px-1.5 !py-1 !text-sm !leading-6 text-transparent caret-text-dark outline-none selection:bg-accent/45 selection:text-white focus:!border-transparent focus:!ring-0 focus:!shadow-none focus-visible:!ring-0 whitespace-pre-wrap break-words disabled:cursor-default ${promptInvalid ? 'placeholder:text-red-400/90' : 'placeholder:text-text-muted/80'}`}
              pickerClassName="z-[90] w-[120px]"
              pickerListClassName="max-h-[180px]"
            />
          </div>
        </div>

        <NodeInputRows
          className="shrink-0"
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


      <Handle
        type="source"
        id="source"
        position={Position.Right}
        className={`${NODE_PORT_NODE_CLASS} ${hasSourceConnections ? NODE_PORT_VISIBLE_CLASS : ''}`}
        style={{ background: getSocketColor(modelType.toUpperCase()), right: 0, top: '50%', transform: 'translate(50%, -50%)' }}
      />
      <NodeResizeHandle
        minWidth={minWidth}
        minHeight={minHeight}
        maxWidth={maxWidth}
        maxHeight={maxHeight}
      />
    </div>
  );
});

GenerationNodeShell.displayName = 'GenerationNodeShell';
