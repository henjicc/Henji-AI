import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNodeId } from '@xyflow/react';

import type { ModelTag } from '@/core/types';
import { PanelTrigger, UiFieldTrigger } from '@/components/ui';
import type { CanvasModelMediaType } from '@/features/canvas/domain/defaultModels';
import type { CanvasImageCapabilityModelPolicy } from '@/features/canvas/capabilities/types';
import { getProviderDisplayName } from '@/utils/modelHelpers';
import ModelSelectorPanel from '@/components/MediaGenerator/components/ModelSelectorPanel';
import type { GenerationModelFilterType } from '@/features/generation/domain/generationDraft';
import { useGenerationDraftStore } from '@/features/generation/store/generationDraftStore';
import { collectInputMediaByKind } from '@/features/canvas/application/graphMediaResolver';
import { inferModelFunctionFilter } from '@/features/canvas/domain/modelFunctionFilter';
import { canvasViewStore } from '@/stores/canvasStore';
import { useModelPickerList } from './useModelPickerList';

interface NodeModelParamsControlsProps {
  mediaType: CanvasModelMediaType;
  modelId: string;
  onModelChange: (modelId: string) => void;
  /** 限定可选模型必须同时具备的标签（如仅展示支持图片编辑的模型） */
  requiredTags?: ModelTag[];
  /** 能力级模型家族、供应商组合与语义参数约束 */
  modelPolicy?: CanvasImageCapabilityModelPolicy;
  chipClassName?: string;
  modelChipClassName?: string;
  /** 模型 chip 内容（名称+供应商）的实际像素宽度变化回调，用于驱动节点最小宽度随内容自适应 */
  onModelChipContentWidthChange?: (width: number) => void;
}

// 静默触发器 sm 档左右内边距 8 + 8、名称后的下箭头 16 与间距 6（测量层名称与渠道之间 gap 8，余量够用）
const MODEL_CHIP_HORIZONTAL_CHROME = 38;

/**
 * 芯片所在行还能给它多宽：行内容宽减去同排其它占位（标签等）与间距。用 offsetWidth（布局尺寸），
 * 画布缩放的变换不影响结果；芯片自身宽度随内容变化，不能拿它判断“放不放得下”。
 */
function availableChipWidth(root: HTMLElement): number {
  const slot = root.parentElement;
  const row = slot?.parentElement;
  if (!slot || !row) return root.offsetWidth;
  const style = window.getComputedStyle(row);
  const gap = Number.parseFloat(style.columnGap) || 0;
  const inner = row.clientWidth - (Number.parseFloat(style.paddingLeft) || 0) - (Number.parseFloat(style.paddingRight) || 0);
  const siblings = Array.from(row.children).filter((child): child is HTMLElement => child !== slot
    && child instanceof HTMLElement && window.getComputedStyle(child).position !== 'absolute');
  return inner - siblings.reduce((sum, child) => sum + child.offsetWidth + gap, 0);
}

export const NodeModelParamsControls = memo(({
  mediaType,
  modelId,
  onModelChange,
  requiredTags = [],
  modelPolicy,
  chipClassName = '',
  modelChipClassName = 'max-w-[260px] justify-start',
  onModelChipContentWidthChange,
}: NodeModelParamsControlsProps) => {
  const { t, i18n } = useTranslation();
  const modelChipMeasureRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // 放不下“模型名 + 渠道”时只显示模型名，渠道进悬停说明：模型名是主要信息，不能被截成“GPT Im…”（5.8 shortTextTruncated）
  const [compactChip, setCompactChip] = useState(false);
  // 模型面板与生成页同一个（左栏供应商、搜索、功能筛选、收藏），类型锁定为本节点的媒体类型
  const [panelOpen, setPanelOpen] = useState(false);
  const { models, selectedModel, selectedModelName } = useModelPickerList({ mediaType, modelId, requiredTags, modelPolicy });
  const allowedModelIds = useMemo(() => new Set(models.map((model) => model.meta.id)), [models]);
  const isModelAllowed = useCallback((_providerId: string, id: string) => allowedModelIds.has(id), [allowedModelIds]);
  const lockedType: GenerationModelFilterType = mediaType;
  const [filterProvider, setFilterProvider] = useState('all');
  const [filterType, setFilterType] = useState<GenerationModelFilterType>(lockedType);
  const [filterFunction, setFilterFunction] = useState('all');
  const favorites = useGenerationDraftStore((state) => state.draft.favoriteModels);
  const patchDraftField = useGenerationDraftStore((state) => state.patchField);
  const nodeId = useNodeId();
  // 打开面板那一刻按节点的素材（连线进来的与本地上传的）预选功能；只在打开时算一次，不随画布每次变化重算
  const readInputCounts = (): { images: number; videos: number; audios: number } => {
    const { nodes, edges } = canvasViewStore.getState();
    const node = nodeId ? nodes.find((candidate) => candidate.id === nodeId) : undefined;
    const inline = (node?.data as { mediaInputs?: Partial<Record<'image' | 'video' | 'audio', unknown[]>> } | undefined)?.mediaInputs ?? {};
    const count = (kind: 'image' | 'video' | 'audio'): number => {
      const connected = nodeId ? collectInputMediaByKind(nodeId, nodes, edges, kind).length : 0;
      return connected > 0 ? connected : (Array.isArray(inline[kind]) ? inline[kind]!.length : 0);
    };
    return { images: count('image'), videos: count('video'), audios: count('audio') };
  };

  useLayoutEffect(() => {
    const measureEl = modelChipMeasureRef.current;
    if (!measureEl || !onModelChipContentWidthChange) {
      return;
    }
    const measure = () => onModelChipContentWidthChange(measureEl.scrollWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(measureEl);
    return () => observer.disconnect();
  }, [onModelChipContentWidthChange, selectedModelName, selectedModel]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const measureEl = modelChipMeasureRef.current;
    const row = root?.parentElement?.parentElement;
    if (!root || !measureEl) return;
    const update = () => setCompactChip(availableChipWidth(root) < measureEl.scrollWidth + MODEL_CHIP_HORIZONTAL_CHROME);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(measureEl);
    if (row) observer.observe(row);
    return () => observer.disconnect();
  }, [selectedModelName, selectedModel]);

  return (
    <div ref={rootRef} className="relative flex w-full min-w-0 items-center gap-1">
      <PanelTrigger
        className="flex min-w-0 flex-1"
        open={panelOpen}
        onOpenChange={setPanelOpen}
        surface="glass"
        // 特殊面板（重要记录 021）：宽度量最长的模型名，在模型这一行下面展开、不盖住它
        panelSize="special"
        alignment="bottomCenter"
        stableHeight
        renderPanel={() => (
          <ModelSelectorPanel
            selectedProvider={selectedModel?.meta.provider ?? ''}
            selectedModel={selectedModel?.meta.id ?? ''}
            modelFilterProvider={filterProvider}
            modelFilterType={filterType}
            modelFilterFunction={filterFunction}
            favoriteModels={favorites}
            typeLocked={lockedType}
            isModelAllowed={isModelAllowed}
            onModelSelect={(_providerId, nextModelId) => {
              onModelChange(nextModelId);
              setPanelOpen(false);
            }}
            onFilterProviderChange={setFilterProvider}
            onFilterTypeChange={(type) => setFilterType(type === 'favorite' ? 'favorite' : lockedType)}
            onFilterFunctionChange={setFilterFunction}
            onToggleFavorite={(event, providerId, id) => {
              event.stopPropagation();
              const key = `${providerId}-${id}`;
              patchDraftField('favoriteModels', (current) => {
                const next = new Set(current);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              });
            }}
          />
        )}
      >
        {() => (
          // 与节点里其他参数同一种静默触发器（值 + 下箭头，悬停出底）
          <UiFieldTrigger
            appearance="quiet"
            open={panelOpen}
            size="sm"
            aria-expanded={panelOpen}
            data-panel-trigger-button
            data-node-model-trigger
            tooltip={compactChip && selectedModel
              ? `${selectedModelName} · ${getProviderDisplayName(selectedModel.meta.provider, i18n.language)}`
              : undefined}
            className={`min-w-0 overflow-hidden ${chipClassName} ${modelChipClassName}`}
            onClick={(event) => {
              event.stopPropagation();
              if (panelOpen) {
                setPanelOpen(false);
                return;
              }
              setFilterProvider('all');
              setFilterType(lockedType);
              setFilterFunction(inferModelFunctionFilter(mediaType, selectedModel?.meta.tags ?? [], readInputCounts()) ?? 'all');
              setPanelOpen(true);
            }}
          >
            <span className="text-text1">{selectedModelName}</span>
            {selectedModel && !compactChip && (
              <span className="ml-1.5 text-text3">
                {getProviderDisplayName(selectedModel.meta.provider, i18n.language)}
              </span>
            )}
          </UiFieldTrigger>
        )}
      </PanelTrigger>
      {/* 测量层：常驻，算“模型名 + 渠道”的自然宽度（节点自适应宽度与紧凑判定共用） */}
      <div
        ref={modelChipMeasureRef}
        aria-hidden
        className="pointer-events-none invisible absolute left-0 top-0 inline-flex items-center gap-2 whitespace-nowrap text-xs"
      >
        <span className="text-xs font-normal leading-none">{selectedModelName}</span>
        {selectedModel && (
          <span className="text-xs leading-none text-text2">
            {getProviderDisplayName(selectedModel.meta.provider, i18n.language)}
          </span>
        )}
      </div>
    </div>
  );
});

NodeModelParamsControls.displayName = 'NodeModelParamsControls';
