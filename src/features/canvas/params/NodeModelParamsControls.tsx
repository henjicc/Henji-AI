import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Search, SlidersHorizontal, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import PinyinMatch from 'pinyin-match';

import { registry } from '@/core/ModelRegistry';
import { getI18nText } from '@/core/types/I18nText';
import type { ModelDefinition } from '@/core/types';
import { FILTERABLE_TAGS } from '@/core/types/ModelTags';
import { analyzeRatioResolutionParams } from '@/core/params/ratioResolution';
import ParameterPanel from '@/components/MediaGenerator/components/ParameterPanel';
import { UiChipButton, UiIconButton, UiInput, UiOptionButton, UiPanel } from '@/components/ui';
import {
  getProviderDisplayName,
  type CanvasModelMediaType,
} from '@/features/canvas/domain/defaultModels';
import { useNodeModelParams } from './useNodeModelParams';

interface NodeModelParamsControlsProps {
  mediaType: CanvasModelMediaType;
  modelId: string;
  storedParams: DynamicValueMap | undefined;
  onModelChange: (modelId: string) => void;
  onParamsChange: (nextParams: DynamicValueMap) => void;
  /** 上游连线输入的图片（用于智能宽高比预览与联动） */
  incomingImages?: string[];
  chipClassName?: string;
  modelChipClassName?: string;
  paramsChipClassName?: string;
  /** 是否显示参数浮层 chip（逐行渲染模式下置 false，仅保留模型选择） */
  showParamsChip?: boolean;
  /** 模型 chip 内容（名称+供应商）的实际像素宽度变化回调，用于驱动节点最小宽度随内容自适应 */
  onModelChipContentWidthChange?: (width: number) => void;
}

interface PanelAnchor {
  left: number;
  top: number;
}

interface ProviderFilterOption {
  id: string;
  label: string;
  count: number;
}

function getPanelAnchor(triggerElement: HTMLDivElement | null): PanelAnchor | null {
  if (!triggerElement) {
    return null;
  }
  const rect = triggerElement.getBoundingClientRect();
  return {
    left: rect.left + rect.width / 2,
    top: rect.top - 8,
  };
}

function buildPanelStyle(anchor: PanelAnchor | null): React.CSSProperties | undefined {
  if (!anchor) {
    return undefined;
  }
  return {
    left: anchor.left,
    top: anchor.top,
    transform: 'translateX(-50%) translateY(-100%)',
  };
}

function getModelFunctionLabels(model: ModelDefinition, translateTag: (tag: string) => string): string[] {
  return (model.meta.tags ?? [])
    .filter((tag) => FILTERABLE_TAGS.includes(tag))
    .map((tag) => translateTag(tag));
}

function matchesModelSearch(model: ModelDefinition, query: string, language: string): boolean {
  const keyword = query.trim();
  if (!keyword) {
    return true;
  }
  const displayName = getI18nText(model.meta.name, language) || model.meta.id;
  const description = model.meta.description ? getI18nText(model.meta.description, language) : '';
  const haystack = [
    displayName,
    model.meta.id,
    model.meta.provider,
    getProviderDisplayName(model.meta.provider),
    description,
    ...(model.meta.aliases ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const normalizedKeyword = keyword.toLowerCase();
  return haystack.includes(normalizedKeyword) || Boolean(PinyinMatch.match(displayName, keyword));
}

export const NodeModelParamsControls = memo(({
  mediaType,
  modelId,
  storedParams,
  onModelChange,
  onParamsChange,
  incomingImages = [],
  chipClassName = '',
  modelChipClassName = 'max-w-[260px] justify-start',
  paramsChipClassName = 'max-w-[120px] justify-start',
  showParamsChip = true,
  onModelChipContentWidthChange,
}: NodeModelParamsControlsProps) => {
  const { t, i18n } = useTranslation();
  const { t: tModels } = useTranslation('models');
  const containerRef = useRef<HTMLDivElement>(null);
  const modelTriggerRef = useRef<HTMLDivElement>(null);
  const modelChipMeasureRef = useRef<HTMLDivElement>(null);
  const paramsTriggerRef = useRef<HTMLDivElement>(null);
  const modelPanelRef = useRef<HTMLDivElement>(null);
  const paramsPanelRef = useRef<HTMLDivElement>(null);
  const modelSearchInputRef = useRef<HTMLInputElement>(null);
  const [openPanel, setOpenPanel] = useState<'model' | 'params' | null>(null);
  const [renderPanel, setRenderPanel] = useState<'model' | 'params' | null>(null);
  const [isPanelVisible, setIsPanelVisible] = useState(false);
  const [modelPanelAnchor, setModelPanelAnchor] = useState<PanelAnchor | null>(null);
  const [paramsPanelAnchor, setParamsPanelAnchor] = useState<PanelAnchor | null>(null);
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const [providerFilter, setProviderFilter] = useState('all');

  const models = useMemo(() => registry.getModelsByType(mediaType), [mediaType]);
  const providerOptions = useMemo<ProviderFilterOption[]>(() => {
    const counts = new Map<string, number>();
    for (const model of models) {
      counts.set(model.meta.provider, (counts.get(model.meta.provider) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([id, count]) => ({ id, label: getProviderDisplayName(id), count }))
      .sort((a, b) => a.label.localeCompare(b.label, i18n.language));
  }, [i18n.language, models]);
  const filteredModels = useMemo(
    () => models.filter((model) => {
      if (providerFilter !== 'all' && model.meta.provider !== providerFilter) {
        return false;
      }
      return matchesModelSearch(model, modelSearchQuery, i18n.language);
    }),
    [i18n.language, modelSearchQuery, models, providerFilter]
  );
  const selectedModel = useMemo(
    () => registry.getModel(modelId) ?? models[0],
    [modelId, models]
  );
  const selectedModelName = selectedModel
    ? getI18nText(selectedModel.meta.name, i18n.language) || selectedModel.meta.id
    : modelId;

  const { schema, values, setParam } = useNodeModelParams({
    modelId: selectedModel?.meta.id ?? modelId,
    storedParams,
    onParamsChange,
  });

  // 参数 chip 摘要：优先显示宽高比/分辨率参数当前值
  const paramsSummary = useMemo(() => {
    const spec = analyzeRatioResolutionParams(schema, incomingImages);
    const parts: string[] = [];
    for (const descriptor of [spec?.aspectParam, spec?.resolutionParam]) {
      if (!descriptor) {
        continue;
      }
      const currentValue = values[descriptor.id];
      const matched = descriptor.options.find((option) => option.value === currentValue);
      if (matched) {
        const label = getI18nText(matched.label, i18n.language);
        if (label) {
          parts.push(label);
        }
      }
    }
    return parts;
  }, [i18n.language, incomingImages, schema, values]);

  const hasConfigurableParams = showParamsChip && schema.length > 0;

  useEffect(() => {
    const animationDurationMs = 200;
    let enterRaf1: number | null = null;
    let enterRaf2: number | null = null;
    let switchTimer: ReturnType<typeof setTimeout> | null = null;

    const startEnterAnimation = () => {
      enterRaf1 = requestAnimationFrame(() => {
        enterRaf2 = requestAnimationFrame(() => {
          setIsPanelVisible(true);
        });
      });
    };
    const cleanup = () => {
      if (switchTimer) clearTimeout(switchTimer);
      if (enterRaf1) cancelAnimationFrame(enterRaf1);
      if (enterRaf2) cancelAnimationFrame(enterRaf2);
    };

    if (!openPanel) {
      setIsPanelVisible(false);
      switchTimer = setTimeout(() => setRenderPanel(null), animationDurationMs);
      return cleanup;
    }

    if (renderPanel && renderPanel !== openPanel) {
      setIsPanelVisible(false);
      switchTimer = setTimeout(() => {
        setRenderPanel(openPanel);
        startEnterAnimation();
      }, animationDurationMs);
      return cleanup;
    }

    if (!renderPanel) {
      setRenderPanel(openPanel);
    }
    startEnterAnimation();
    return cleanup;
  }, [openPanel, renderPanel]);

  useEffect(() => {
    if (providerFilter !== 'all' && !providerOptions.some((option) => option.id === providerFilter)) {
      setProviderFilter('all');
    }
  }, [providerFilter, providerOptions]);

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
    const handleOutside = (event: MouseEvent) => {
      const target = event.target as globalThis.Node;
      if (containerRef.current?.contains(target)) return;
      if (modelPanelRef.current?.contains(target)) return;
      if (paramsPanelRef.current?.contains(target)) return;
      setOpenPanel(null);
    };

    document.addEventListener('mousedown', handleOutside, true);
    return () => {
      document.removeEventListener('mousedown', handleOutside, true);
    };
  }, []);

  useEffect(() => {
    if (renderPanel !== 'model') {
      return;
    }
    const shouldAutoFocus = localStorage.getItem('enable_auto_focus_model_search') !== 'false';
    if (!shouldAutoFocus) {
      return;
    }
    const timer = setTimeout(() => modelSearchInputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [renderPanel]);

  return (
    <div ref={containerRef} className="flex w-full min-w-0 items-center gap-1">
      <div ref={modelTriggerRef} className="relative flex min-w-0 flex-1">
        <UiChipButton
          active={openPanel === 'model'}
          className={`min-w-0 overflow-hidden ${chipClassName} ${modelChipClassName}`}
          onClick={(event) => {
            event.stopPropagation();
            if (openPanel === 'model') {
              setOpenPanel(null);
              return;
            }
            setModelPanelAnchor(getPanelAnchor(modelTriggerRef.current));
            setOpenPanel('model');
          }}
        >
          <span className="min-w-0 flex-1 truncate text-xs font-normal leading-none">{selectedModelName}</span>
          {selectedModel && (
            <span className="shrink-0 text-xs leading-none text-text-muted/80">
              {getProviderDisplayName(selectedModel.meta.provider)}
            </span>
          )}
        </UiChipButton>
        {onModelChipContentWidthChange && (
          <div
            ref={modelChipMeasureRef}
            aria-hidden
            className="pointer-events-none invisible absolute left-0 top-0 inline-flex items-center gap-2 whitespace-nowrap text-xs"
          >
            <span className="text-xs font-normal leading-none">{selectedModelName}</span>
            {selectedModel && (
              <span className="text-xs leading-none text-text-muted/80">
                {getProviderDisplayName(selectedModel.meta.provider)}
              </span>
            )}
          </div>
        )}
      </div>

      {hasConfigurableParams && (
        <div ref={paramsTriggerRef} className="relative flex">
          <UiChipButton
            active={openPanel === 'params'}
            className={`${chipClassName} ${paramsChipClassName}`}
            onClick={(event) => {
              event.stopPropagation();
              if (openPanel === 'params') {
                setOpenPanel(null);
                return;
              }
              setParamsPanelAnchor(getPanelAnchor(paramsTriggerRef.current));
              setOpenPanel('params');
            }}
          >
            <SlidersHorizontal className="h-2.5 w-2.5 shrink-0" />
            {paramsSummary.length > 0 ? (
              <>
                <span className="truncate text-xs leading-none">{paramsSummary[0]}</span>
                {paramsSummary[1] && (
                  <span className="text-xs leading-none text-text-muted/80">· {paramsSummary[1]}</span>
                )}
              </>
            ) : (
              <span className="truncate text-xs leading-none">{t('modelParams.title')}</span>
            )}
          </UiChipButton>
        </div>
      )}

      {typeof document !== 'undefined' && renderPanel === 'model' && createPortal(
        <div
          ref={modelPanelRef}
          className={`nodrag nowheel fixed z-[80] transition-opacity duration-200 ease-out ${
            isPanelVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
          style={buildPanelStyle(modelPanelAnchor)}
        >
          <UiPanel className="w-[420px] p-2">
            <div className="space-y-2 border-b border-border-dark/70 pb-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
                <UiInput
                  ref={modelSearchInputRef}
                  type="text"
                  value={modelSearchQuery}
                  onChange={(event) => setModelSearchQuery(event.target.value)}
                  onKeyDown={(event) => event.stopPropagation()}
                  placeholder={t('modelParams.searchPlaceholder', { defaultValue: '搜索模型名称、供应商或描述' })}
                  className="h-8 rounded-md pl-8 pr-8 text-xs"
                />
                {modelSearchQuery && (
                  <UiIconButton
                    type="button"
                    showBorder={false}
                    onClick={(event) => {
                      event.stopPropagation();
                      setModelSearchQuery('');
                    }}
                    className="absolute right-1 top-1/2 !h-6 !w-6 -translate-y-1/2 !border-0 !bg-transparent !p-0 text-text-muted hover:!bg-layer hover:!text-text-dark"
                    title={t('modelParams.clearSearch', { defaultValue: '清空搜索' })}
                  >
                    <X className="h-3.5 w-3.5" />
                  </UiIconButton>
                )}
              </div>
              <div className="ui-scrollbar flex max-w-full gap-1 overflow-x-auto pb-0.5">
                <UiChipButton
                  type="button"
                  active={providerFilter === 'all'}
                  onClick={(event) => {
                    event.stopPropagation();
                    setProviderFilter('all');
                  }}
                  className="!h-7 shrink-0 !rounded-md !px-2.5 !text-xs"
                >
                  {t('modelParams.allProviders', { defaultValue: '全部' })}
                </UiChipButton>
                {providerOptions.map((provider) => (
                  <UiChipButton
                    key={provider.id}
                    type="button"
                    active={providerFilter === provider.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      setProviderFilter(provider.id);
                    }}
                    className="!h-7 shrink-0 !rounded-md !px-2.5 !text-xs"
                  >
                    <span>{provider.label}</span>
                    <span className="text-[10px] text-text-muted/80">{provider.count}</span>
                  </UiChipButton>
                ))}
              </div>
            </div>
            <div className="ui-scrollbar mt-2 max-h-[300px] space-y-1 overflow-y-auto pr-1">
              {filteredModels.map((model) => {
                const active = model.meta.id === selectedModel?.meta.id;
                const displayName = getI18nText(model.meta.name, i18n.language) || model.meta.id;
                const functionLabels = getModelFunctionLabels(model, (tag) => tModels(`tags.${tag}`, { defaultValue: tag }));

                return (
                  <UiOptionButton
                    key={model.meta.id}
                    active={active}
                    className={`w-full items-start gap-3 rounded-lg px-3 py-2 ${
                      active ? '' : '!border-transparent !bg-transparent hover:!border-transparent hover:!bg-layer'
                    }`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onModelChange(model.meta.id);
                      setOpenPanel(null);
                    }}
                  >
                    {model.meta.icon && (
                      <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg text-text-muted ${active ? 'bg-white/15 text-white' : 'bg-bg-dark'}`}>
                        <img src={model.meta.icon} alt="" className="h-full w-full object-cover" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className={`truncate text-sm ${active ? 'text-white' : 'text-text-dark'}`}>{displayName}</div>
                      <div className={`truncate text-xs ${active ? 'text-white/70' : 'text-text-muted'}`}>
                        {getProviderDisplayName(model.meta.provider)}
                        {functionLabels.length > 0 ? ` · ${functionLabels.join(' · ')}` : ''}
                      </div>
                    </div>
                    {active && <Check className="mt-0.5 h-4 w-4 shrink-0 text-white" />}
                  </UiOptionButton>
                );
              })}
              {filteredModels.length === 0 && (
                <div className="px-3 py-8 text-center text-xs text-text-muted">
                  {t('modelParams.noModels', { defaultValue: '没有匹配的模型' })}
                </div>
              )}
            </div>
          </UiPanel>
        </div>,
        document.body
      )}

      {typeof document !== 'undefined' && renderPanel === 'params' && selectedModel && createPortal(
        <div
          ref={paramsPanelRef}
          className={`nodrag nowheel fixed z-[80] transition-opacity duration-200 ease-out ${
            isPanelVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
          style={buildPanelStyle(paramsPanelAnchor)}
        >
          <UiPanel className="w-[440px] p-3">
            <div className="ui-scrollbar max-h-[360px] overflow-y-auto pr-1">
              <ParameterPanel
                currentModel={selectedModel}
                selectedModel={selectedModel.meta.id}
                uploadedImages={incomingImages}
                uploadedVideos={[]}
                values={values}
                onChange={setParam}
              />
            </div>
          </UiPanel>
        </div>,
        document.body
      )}
    </div>
  );
});

NodeModelParamsControls.displayName = 'NodeModelParamsControls';
