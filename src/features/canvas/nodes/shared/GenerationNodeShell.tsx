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
import { getDefaultModelId } from '@/features/canvas/domain/defaultModels';
import { getNodeDefinition } from '@/features/canvas/domain/nodeRegistry';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import {
  areMediaOutputListsEqual,
  collectInputMedia,
} from '@/features/canvas/application/graphMediaResolver';
import { runCanvasGeneration } from '@/features/canvas/generation/runGeneration';
import { persistGenerationResult } from '@/features/canvas/generation/mediaResultPersist';
import { NodeModelParamsControls } from '@/features/canvas/params/NodeModelParamsControls';
import { useNodeModelParams } from '@/features/canvas/params/useNodeModelParams';
import { stripReferenceAtPrefix } from '@/core/inputs/referenceTokens';
import { registry } from '@/core/ModelRegistry';
import { GenerationService } from '@/core/services/GenerationService';
import {
  NODE_CONTROL_CHIP_CLASS,
  NODE_CONTROL_ICON_CLASS,
  NODE_CONTROL_MODEL_CHIP_CLASS,
  NODE_CONTROL_PARAMS_CHIP_CLASS,
  NODE_CONTROL_PRIMARY_BUTTON_CLASS,
} from '@/features/canvas/ui/nodeControlStyles';
import { ReferenceTextarea, UiButton } from '@/components/ui';
import PriceEstimate from '@/components/ui/PriceEstimate';
import { useCanvasStore } from '@/stores/canvasStore';
import { useSettingsStore } from '@/stores/settingsStore';

const DEFAULT_GENERATION_DURATION_MS = 60_000;
const RESULT_TITLE_MAX_CHARS = 10;

export interface GenerationNodeShellData {
  displayName?: string;
  prompt: string;
  modelId?: string;
  params?: Record<string, unknown>;
  [key: string]: unknown;
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
  resultNodeExtraData?: Record<string, unknown>;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  defaultWidth?: number;
  defaultHeight?: number;
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
 * 生成类节点通用壳：标题 + 提示词输入（@引用）+ 模型/参数条 + 生成按钮 + 端口。
 * 生成行为由 nodeRegistry 中该节点类型的 generation/ports 声明驱动。
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
  minWidth = 420,
  minHeight = 280,
  maxWidth = 1400,
  maxHeight = 1000,
  defaultWidth = 520,
  defaultHeight = 320,
}: GenerationNodeShellProps) => {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);

  const [promptDraft, setPromptDraft] = useState(() => data.prompt ?? '');
  const promptDraftRef = useRef(promptDraft);

  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const setNodeGenerationProgress = useCanvasStore((state) => state.setNodeGenerationProgress);
  const addNode = useCanvasStore((state) => state.addNode);
  const findNodePosition = useCanvasStore((state) => state.findNodePosition);
  const addEdge = useCanvasStore((state) => state.addEdge);
  const providerKeyStatus = useSettingsStore((state) => state.providerKeyStatus);

  const definition = useMemo(() => getNodeDefinition(nodeType), [nodeType]);
  const generationSpec = definition.generation;
  const modelType = generationSpec?.modelType ?? 'image';
  const resultNodeType = (generationSpec?.resultNodeType ?? CANVAS_NODE_TYPES.exportImage) as CanvasNodeType;
  const acceptedKinds = useMemo(
    () => definition.ports?.target?.accepts ?? [],
    [definition]
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

  const incomingImageItems = useMemo(
    () =>
      incomingImages.map((imageUrl, index) => ({
        id: `image-ref-${index}`,
        label: `图${index + 1}`,
        thumbnailSrc: imageUrl,
      })),
    [incomingImages]
  );

  const selectedModelId = useMemo(() => {
    const stored = typeof data.modelId === 'string' ? data.modelId.trim() : '';
    if (stored && registry.getModel(stored)) {
      return stored;
    }
    return getDefaultModelId(modelType);
  }, [data.modelId, modelType]);
  const selectedModel = useMemo(() => registry.getModel(selectedModelId), [selectedModelId]);
  const providerKeyConfigured = selectedModel
    ? providerKeyStatus[selectedModel.meta.provider] === true
    : false;

  const handleParamsChange = useCallback((nextParams: Record<string, unknown>) => {
    updateNodeData(id, { params: nextParams });
  }, [id, updateNodeData]);

  const { values: modelParamValues } = useNodeModelParams({
    modelId: selectedModelId,
    storedParams: data.params,
    onParamsChange: handleParamsChange,
  });

  const handleModelChange = useCallback((nextModelId: string) => {
    updateNodeData(id, { modelId: nextModelId, params: {} });
  }, [id, updateNodeData]);

  const resolvedTitle = useMemo(
    () => resolveNodeDisplayName(nodeType, data as CanvasNodeData),
    [data, nodeType]
  );

  const resolvedWidth = Math.max(minWidth, Math.round(width ?? defaultWidth));
  const resolvedHeight = Math.max(minHeight, Math.round(height ?? defaultHeight));

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
    const prompt = stripReferenceAtPrefix(promptDraft).trim();
    if (!prompt) {
      setError(t(promptRequiredKey));
      return;
    }

    if (!providerKeyConfigured) {
      setError(t(apiKeyRequiredKey));
      return;
    }

    const generationParams: Record<string, unknown> = {
      ...modelParamValues,
      prompt,
      text: prompt,
    };
    const estimateParams: Record<string, unknown> = {
      ...generationParams,
      ...(incomingImages.length > 0
        ? { images: incomingImages, uploadedFilePaths: incomingImages }
        : {}),
      ...(incomingVideos.length > 0
        ? { videos: incomingVideos, uploadedVideoFilePaths: incomingVideos }
        : {}),
    };
    const estimate = await GenerationService.getInstance().getProgressEstimate(
      selectedModelId,
      estimateParams
    );
    const generationDurationMs = estimate?.durationMs ?? DEFAULT_GENERATION_DURATION_MS;
    const generationStartedAt = Date.now();
    const resultNodeTitle = buildResultNodeTitle(prompt, t(resultTitleKey));
    setError(null);

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
        modelId: selectedModelId,
        mediaType: modelType,
        params: generationParams,
        upstream: {
          images: incomingImages,
          videos: incomingVideos,
          audios: incomingAudios,
        },
        onProgress: (progress) => setNodeGenerationProgress(newNodeId, progress),
      });

      const resultPatch = await persistGenerationResult(modelType, result.primary);
      updateNodeData(newNodeId, {
        ...resultPatch,
        isGenerating: false,
        generationStartedAt: null,
      });
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : t('ai.error'));
      updateNodeData(newNodeId, {
        isGenerating: false,
        generationStartedAt: null,
      });
    } finally {
      setNodeGenerationProgress(newNodeId, null);
    }
  }, [addEdge, addNode, apiKeyRequiredKey, findNodePosition, id, incomingAudios, incomingImages, incomingVideos, modelParamValues, modelType, promptDraft, promptRequiredKey, providerKeyConfigured, resultNodeExtraData, resultNodeType, resultTitleKey, selectedModelId, setNodeGenerationProgress, t, updateNodeData]);

  return (
    <div
      className={`
        group relative flex h-full flex-col overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/90 p-2 transition-colors duration-150
        ${selected
          ? 'border-accent shadow-[0_0_0_1px_rgba(59,130,246,0.32)]'
          : 'border-[rgba(255,255,255,0.22)] hover:border-[rgba(255,255,255,0.34)]'}
      `}
      style={{ width: `${resolvedWidth}px`, height: `${resolvedHeight}px` }}
      onClick={() => setSelectedNode(id)}
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={icon ?? <Sparkles className="h-4 w-4" />}
        titleText={resolvedTitle}
        editable
        onTitleChange={(nextTitle) => updateNodeData(id, { displayName: nextTitle })}
      />

      <div className="relative min-h-0 flex-1 rounded-lg border border-[rgba(255,255,255,0.1)] bg-bg-dark/45 p-2">
        <ReferenceTextarea
          value={promptDraft}
          onChange={(nextValue) => {
            setPromptDraft(nextValue);
            commitPromptDraft(nextValue);
          }}
          references={incomingImageItems}
          onMouseDown={(event) => event.stopPropagation()}
          placeholder={t(promptPlaceholderKey)}
          submitShortcut="mod-enter"
          onSubmit={() => {
            void handleGenerate();
          }}
          className="relative h-full min-h-0"
          highlightLayerClassName="text-sm leading-6 text-text-dark"
          highlightContentClassName="px-1 py-0.5"
          textareaClassName="ui-scrollbar nodrag nowheel relative z-10 h-full w-full resize-none overflow-y-auto overflow-x-hidden border-none bg-transparent px-1 py-0.5 text-sm leading-6 text-transparent caret-text-dark outline-none placeholder:text-text-muted/80 focus:border-transparent whitespace-pre-wrap break-words"
          pickerClassName="w-[120px]"
          pickerListClassName="max-h-[180px]"
        />
      </div>

      <div className="mt-2 flex shrink-0 items-center gap-1">
        <NodeModelParamsControls
          mediaType={modelType}
          modelId={selectedModelId}
          storedParams={data.params}
          onModelChange={handleModelChange}
          onParamsChange={handleParamsChange}
          incomingImages={incomingImages}
          chipClassName={NODE_CONTROL_CHIP_CLASS}
          modelChipClassName={NODE_CONTROL_MODEL_CHIP_CLASS}
          paramsChipClassName={NODE_CONTROL_PARAMS_CHIP_CLASS}
        />

        <div className="ml-auto" />

        {selectedModel && (
          <PriceEstimate
            providerId={selectedModel.meta.provider}
            modelId={selectedModelId}
            params={modelParamValues}
            variant="badge"
          />
        )}

        <UiButton
          onClick={(event) => {
            event.stopPropagation();
            void handleGenerate();
          }}
          variant="primary"
          className={`shrink-0 ${NODE_CONTROL_PRIMARY_BUTTON_CLASS}`}
        >
          <Sparkles className={NODE_CONTROL_ICON_CLASS} strokeWidth={2.8} />
          {t('canvas.generate')}
        </UiButton>
      </div>

      {error && <div className="mt-1 shrink-0 text-xs text-red-400">{error}</div>}

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
        minWidth={minWidth}
        minHeight={minHeight}
        maxWidth={maxWidth}
        maxHeight={maxHeight}
      />
    </div>
  );
});

GenerationNodeShell.displayName = 'GenerationNodeShell';
