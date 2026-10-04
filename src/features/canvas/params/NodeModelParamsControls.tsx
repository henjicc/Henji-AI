import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ModelTag } from '@/core/types';
import { PanelTrigger, UiChipButton } from '@/components/ui';
import type { CanvasModelMediaType } from '@/features/canvas/domain/defaultModels';
import type { CanvasImageCapabilityModelPolicy } from '@/features/canvas/capabilities/types';
import { getProviderDisplayName } from '@/utils/modelHelpers';
import { ModelPickerList } from './ModelPickerList';
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

const MODEL_PANEL_FALLBACK_CONTENT_WIDTH = 302;
// 浮层 panelPadding="content"（左右各 12）+ 边框 2
const MODEL_PANEL_HORIZONTAL_CHROME = 26;
const MODEL_PANEL_GAP = 8;

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
  const modelSearchInputRef = useRef<HTMLInputElement>(null);
  // 模型面板走共享浮层 PanelTrigger（任务 5.9）：定位、玻璃表面、点外与 Escape 关闭、子浮层归属都由它处理
  const [panelOpen, setPanelOpen] = useState(false);
  const [modelPanelContentWidth, setModelPanelContentWidth] = useState(0);
  const {
    modelSearchQuery,
    setModelSearchQuery,
    providerFilter,
    setProviderFilter,
    providerOptions,
    providerModels,
    filteredModels,
    selectedModelOption,
    selectedModel,
    selectedModelName,
    hasCompatibleModels,
  } = useModelPickerList({ mediaType, modelId, requiredTags, modelPolicy });

  const modelPanelWidth = (modelPanelContentWidth || MODEL_PANEL_FALLBACK_CONTENT_WIDTH) + MODEL_PANEL_HORIZONTAL_CHROME;

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

  useEffect(() => {
    if (!panelOpen) {
      return;
    }
    const shouldAutoFocus = localStorage.getItem('enable_auto_focus_model_search') !== 'false';
    if (!shouldAutoFocus) {
      return;
    }
    const timer = setTimeout(() => modelSearchInputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [panelOpen]);

  return (
    <div className="relative flex w-full min-w-0 items-center gap-1">
      <PanelTrigger
        className="flex min-w-0 flex-1"
        open={panelOpen}
        onOpenChange={setPanelOpen}
        surface="glass"
        panelPadding="content"
        panelWidth={modelPanelWidth}
        alignment="aboveCenter"
        gap={MODEL_PANEL_GAP}
        renderPanel={() => (
          <div className="nodrag nowheel flex min-h-0 flex-col">
            <ModelPickerList
              variant="floating"
              modelSearchQuery={modelSearchQuery}
              onSearchChange={setModelSearchQuery}
              searchInputRef={modelSearchInputRef}
              providerFilter={providerFilter}
              onProviderFilterChange={setProviderFilter}
              providerOptions={providerOptions}
              modelsForWidthMeasurement={providerModels}
              onPreferredWidthChange={setModelPanelContentWidth}
              filteredModels={filteredModels}
              selectedModel={selectedModelOption}
              emptyMessage={!hasCompatibleModels && modelPolicy
                ? t('modelParams.noCompatibleModels', {
                  defaultValue: '当前能力没有兼容的模型，请检查供应商或模型配置',
                })
                : undefined}
              revealSelectedModel={panelOpen}
              onModelChange={(nextModelId) => {
                onModelChange(nextModelId);
                setPanelOpen(false);
              }}
            />
          </div>
        )}
      >
        {() => (
          <UiChipButton
            active={panelOpen}
            size="sm"
            aria-expanded={panelOpen}
            data-panel-trigger-button
            data-node-model-trigger
            className={`min-w-0 overflow-hidden ${chipClassName} ${modelChipClassName}`}
            onClick={(event) => {
              event.stopPropagation();
              if (panelOpen) {
                setPanelOpen(false);
                return;
              }
              setModelSearchQuery('');
              setProviderFilter(selectedModel?.meta.provider ?? 'all');
              setPanelOpen(true);
            }}
          >
            <span className="min-w-0 flex-1 truncate text-xs font-normal leading-none">{selectedModelName}</span>
            {selectedModel && (
              <span className={`shrink-0 text-xs leading-none text-text2`}>
                {getProviderDisplayName(selectedModel.meta.provider, i18n.language)}
              </span>
            )}
          </UiChipButton>
        )}
      </PanelTrigger>
      {onModelChipContentWidthChange && (
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
      )}
    </div>
  );
});

NodeModelParamsControls.displayName = 'NodeModelParamsControls';
