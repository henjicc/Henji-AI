import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Check, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  UiIconButton,
  UiInput,
  UiOptionButton,
} from '@/components/ui';
import type { ModelPickerOption, ProviderFilterOption } from './useModelPickerList';

interface ModelPickerListProps {
  modelSearchQuery: string;
  onSearchChange: (value: string) => void;
  searchInputRef?: RefObject<HTMLInputElement>;
  providerFilter: string;
  onProviderFilterChange: (id: string) => void;
  providerOptions: ProviderFilterOption[];
  filteredModels: ModelPickerOption[];
  selectedModel: ModelPickerOption | undefined;
  onModelChange: (modelKey: string) => void;
  /** 浮层宽度按当前供应商的完整候选集测量，搜索时保持稳定 */
  modelsForWidthMeasurement?: ModelPickerOption[];
  onPreferredWidthChange?: (width: number) => void;
  /** 面板打开时，将当前模型尽可能垂直居中到列表视口 */
  revealSelectedModel?: boolean;
  /** floating：悬浮面板，列表使用稳定视口高度；inline：节点内嵌正文，列表随可用空间伸展 */
  variant?: 'floating' | 'inline';
  /** 能力约束筛掉全部候选时展示的稳定原因；搜索无结果仍使用通用文案。 */
  emptyMessage?: string;
}

const MODEL_LIST_SCROLLBAR_CHROME = 11;

interface ProviderScrollMetrics {
  maxScrollLeft: number;
  scrollLeft: number;
  thumbLeftPercent: number;
  thumbWidthPercent: number;
}

interface ProviderScrollDrag {
  pointerId: number;
  startClientX: number;
  startScrollLeft: number;
  trackScrollableWidth: number;
}

const EMPTY_PROVIDER_SCROLL_METRICS: ProviderScrollMetrics = {
  maxScrollLeft: 0,
  scrollLeft: 0,
  thumbLeftPercent: 0,
  thumbWidthPercent: 100,
};

const PROVIDER_SCROLL_THUMB_MIN_PERCENT = 16;

function getModelDetail(option: ModelPickerOption): string {
  return [option.providerName, ...(option.detailLabels ?? [])].join(' · ');
}

/** 搜索框 + 供应商筛选 chip 行 + 可滚动模型列表，被悬浮面板与节点内嵌展开正文共用 */
export function ModelPickerList({
  modelSearchQuery,
  onSearchChange,
  searchInputRef,
  providerFilter,
  onProviderFilterChange,
  providerOptions,
  filteredModels,
  selectedModel,
  onModelChange,
  modelsForWidthMeasurement,
  onPreferredWidthChange,
  revealSelectedModel = false,
  variant = 'floating',
  emptyMessage,
}: ModelPickerListProps) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement>(null);
  const selectedModelRef = useRef<HTMLButtonElement>(null);
  const providerListRef = useRef<HTMLDivElement>(null);
  const activeProviderRef = useRef<HTMLButtonElement>(null);
  const providerScrollDragRef = useRef<ProviderScrollDrag | null>(null);
  const widthMeasurementRef = useRef<HTMLDivElement>(null);
  const [providerScrollMetrics, setProviderScrollMetrics] = useState<ProviderScrollMetrics>(
    EMPTY_PROVIDER_SCROLL_METRICS
  );
  const searchPlaceholder = t('modelParams.searchPlaceholder', { defaultValue: '搜索模型名称、供应商或描述' });
  const measuredModels = modelsForWidthMeasurement ?? filteredModels;
  const listClassName = variant === 'inline'
    ? 'ui-scrollbar mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1'
    : 'ui-scrollbar mt-2 h-[300px] min-h-0 shrink space-y-1 overflow-y-auto overscroll-contain pr-1';

  const updateProviderScrollMetrics = useCallback(() => {
    const providerList = providerListRef.current;
    if (!providerList) {
      return;
    }
    const maxScrollLeft = Math.max(0, providerList.scrollWidth - providerList.clientWidth);
    const thumbWidthPercent = maxScrollLeft === 0
      ? 100
      : Math.max(
        PROVIDER_SCROLL_THUMB_MIN_PERCENT,
        Math.min(100, (providerList.clientWidth / providerList.scrollWidth) * 100)
      );
    const scrollProgress = maxScrollLeft === 0 ? 0 : providerList.scrollLeft / maxScrollLeft;
    const nextMetrics = {
      maxScrollLeft,
      scrollLeft: providerList.scrollLeft,
      thumbLeftPercent: scrollProgress * (100 - thumbWidthPercent),
      thumbWidthPercent,
    };
    setProviderScrollMetrics((currentMetrics) => (
      currentMetrics.maxScrollLeft === nextMetrics.maxScrollLeft
      && currentMetrics.scrollLeft === nextMetrics.scrollLeft
      && currentMetrics.thumbLeftPercent === nextMetrics.thumbLeftPercent
      && currentMetrics.thumbWidthPercent === nextMetrics.thumbWidthPercent
        ? currentMetrics
        : nextMetrics
    ));
  }, []);

  useLayoutEffect(() => {
    const providerList = providerListRef.current;
    const activeProvider = activeProviderRef.current;
    if (!providerList || !activeProvider) {
      return;
    }

    const centeredScrollLeft = activeProvider.offsetLeft
      - (providerList.clientWidth - activeProvider.offsetWidth) / 2;
    const maxScrollLeft = Math.max(0, providerList.scrollWidth - providerList.clientWidth);
    providerList.scrollLeft = Math.min(maxScrollLeft, Math.max(0, centeredScrollLeft));
    updateProviderScrollMetrics();
  }, [providerFilter, providerOptions, revealSelectedModel, updateProviderScrollMetrics]);

  useLayoutEffect(() => {
    updateProviderScrollMetrics();
    const providerList = providerListRef.current;
    if (!providerList || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(updateProviderScrollMetrics);
    observer.observe(providerList);
    return () => observer.disconnect();
  }, [providerOptions, updateProviderScrollMetrics]);

  useLayoutEffect(() => {
    if (!revealSelectedModel) {
      return;
    }
    const listElement = listRef.current;
    const selectedElement = selectedModelRef.current;
    if (!listElement || !selectedElement) {
      return;
    }

    const listRect = listElement.getBoundingClientRect();
    const selectedRect = selectedElement.getBoundingClientRect();
    const selectedTop = selectedRect.top - listRect.top + listElement.scrollTop;
    const centeredScrollTop = selectedTop - (listElement.clientHeight - selectedElement.offsetHeight) / 2;
    const maxScrollTop = Math.max(0, listElement.scrollHeight - listElement.clientHeight);
    listElement.scrollTop = Math.min(maxScrollTop, Math.max(0, centeredScrollTop));
  }, [revealSelectedModel, selectedModel?.key]);

  useLayoutEffect(() => {
    const measurementElement = widthMeasurementRef.current;
    if (!measurementElement || !onPreferredWidthChange) {
      return;
    }
    const reportWidth = (): void => {
      // 测内容自身而不是屏幕投影尺寸。PanelTrigger 带 scale 动画且自身已有 width，
      // getBoundingClientRect 会把祖先变换/约束算进去，导致宽面板切到窄供应商时仍回报旧宽度。
      onPreferredWidthChange(Math.ceil(measurementElement.scrollWidth));
    };
    reportWidth();
    const observer = new ResizeObserver(reportWidth);
    observer.observe(measurementElement);
    return () => observer.disconnect();
  }, [measuredModels, onPreferredWidthChange, providerOptions, searchPlaceholder]);

  return (
    <div className={variant === 'inline'
      ? 'flex h-full min-h-0 w-full flex-col'
      : 'flex min-h-0 w-full flex-1 flex-col'}>
      {onPreferredWidthChange && (
        <div
          ref={widthMeasurementRef}
          aria-hidden
          className="pointer-events-none invisible fixed left-0 top-0 -z-10 flex w-max flex-col items-start"
        >
          <div className="whitespace-nowrap border border-transparent px-8 text-xs">{searchPlaceholder}</div>
          {/* 逐项测量供应商 chip；横向相加会把整个筛选行误当成面板最小宽度。 */}
          <div className="mt-2 flex w-max flex-col items-start gap-1">
            <div className="inline-flex h-6 items-center rounded-md border border-transparent px-2 text-2xs">
              {t('modelParams.allProviders', { defaultValue: '全部' })}
            </div>
            {providerOptions.map((provider) => (
              <div
                key={provider.id}
                className="inline-flex h-6 items-center gap-2 rounded-md border border-transparent px-2 text-2xs"
              >
                <span>{provider.label}</span>
                <span className="text-3xs">{provider.count}</span>
              </div>
            ))}
          </div>
          <div className="flex w-max flex-col items-start" style={{ paddingRight: MODEL_LIST_SCROLLBAR_CHROME }}>
            {measuredModels.map((model) => (
              <div key={model.key} className="inline-flex items-start gap-2.5 border border-transparent px-2.5 py-1.5">
                {model.icon && <span className="h-7 w-7 shrink-0" />}
                <div className="flex flex-col">
                  <span className="whitespace-nowrap text-13">{model.displayName}</span>
                  <span className="whitespace-nowrap text-2xs">
                    {getModelDetail(model)}
                  </span>
                </div>
                <Check className="h-3.5 w-3.5 shrink-0" />
              </div>
            ))}
          </div>
        </div>
      )}
      <div data-model-picker-static-header className="shrink-0 space-y-2 border-b border-border-dark/70 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
          <UiInput
            ref={searchInputRef}
            type="text"
            value={modelSearchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            textHistory={{ onValueChange: onSearchChange }}
            onKeyDown={(event) => event.stopPropagation()}
            placeholder={searchPlaceholder}
            className="h-7 rounded-md pl-8 pr-8 text-xs"
          />
          {modelSearchQuery && (
            <UiIconButton
              type="button"
              showBorder={false}
              onClick={(event) => {
                event.stopPropagation();
                onSearchChange('');
              }}
              className="absolute right-1 top-1/2 !h-5 !w-5 -translate-y-1/2 !border-0 !bg-transparent !p-0 text-text-muted hover:!bg-layer hover:!text-text-dark"
              title={t('modelParams.clearSearch', { defaultValue: '清空搜索' })}
            >
              <X className="h-3 w-3" />
            </UiIconButton>
          )}
        </div>
        <div className={variant === 'floating' ? 'relative h-10' : 'relative'}>
          <div
            ref={providerListRef}
            className={variant === 'floating'
              ? 'model-provider-scroll-viewport flex max-w-full gap-1 overflow-x-auto overscroll-x-contain'
              : 'ui-scrollbar flex max-w-full gap-1 overflow-x-scroll overscroll-x-contain pb-2'}
            onScroll={updateProviderScrollMetrics}
            onWheel={(event) => {
              const providerList = event.currentTarget;
              if (providerList.scrollWidth <= providerList.clientWidth) {
                return;
              }
              const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
                ? event.deltaX
                : event.deltaY;
              if (delta === 0) {
                return;
              }
              const nextScrollLeft = Math.min(
                providerList.scrollWidth - providerList.clientWidth,
                Math.max(0, providerList.scrollLeft + delta)
              );
              if (nextScrollLeft !== providerList.scrollLeft) {
                event.preventDefault();
                providerList.scrollLeft = nextScrollLeft;
                updateProviderScrollMetrics();
              }
            }}
          >
            <UiOptionButton
              ref={providerFilter === 'all' ? activeProviderRef : undefined}
              type="button"
              active={providerFilter === 'all'}
              aria-pressed={providerFilter === 'all'}
              onClick={(event) => {
                event.stopPropagation();
                onProviderFilterChange('all');
              }}
              className={`!h-6 shrink-0 !rounded-md !px-2 !text-2xs ${
                providerFilter === 'all'
                  ? ''
                  : '!border-border-dark !bg-panel hover:!border-text-muted hover:!bg-panel'
              }`}
            >
              {t('modelParams.allProviders', { defaultValue: '全部' })}
            </UiOptionButton>
            {providerOptions.map((provider) => {
              const active = providerFilter === provider.id;
              return (
                <UiOptionButton
                  ref={active ? activeProviderRef : undefined}
                  key={provider.id}
                  type="button"
                  active={active}
                  aria-pressed={active}
                  onClick={(event) => {
                    event.stopPropagation();
                    onProviderFilterChange(provider.id);
                  }}
                  className={`!h-6 shrink-0 gap-2 !rounded-md !px-2 !text-2xs ${
                    active
                      ? ''
                      : '!border-border-dark !bg-panel hover:!border-text-muted hover:!bg-panel'
                  }`}
                >
                  <span>{provider.label}</span>
                  <span className={`text-3xs ${active ? 'text-white/70' : 'text-text-muted/80'}`}>
                    {provider.count}
                  </span>
                </UiOptionButton>
              );
            })}
          </div>
          {variant === 'floating' && providerScrollMetrics.maxScrollLeft > 0 && (
            <div
              role="scrollbar"
              aria-label={t('modelParams.providerScrollbar', { defaultValue: '滚动供应商列表' })}
              aria-orientation="horizontal"
              aria-valuemin={0}
              aria-valuemax={Math.ceil(providerScrollMetrics.maxScrollLeft)}
              aria-valuenow={Math.round(providerScrollMetrics.scrollLeft)}
              tabIndex={0}
              className="model-provider-scrollbar absolute inset-x-0 bottom-0 h-4 touch-none cursor-pointer outline-none focus-visible:ring-inset focus-visible:ring-2 focus-visible:ring-accent"
              onPointerDown={(event) => {
                const providerList = providerListRef.current;
                if (!providerList) {
                  return;
                }
                const trackRect = event.currentTarget.getBoundingClientRect();
                const thumbWidth = trackRect.width * providerScrollMetrics.thumbWidthPercent / 100;
                const trackScrollableWidth = Math.max(1, trackRect.width - thumbWidth);
                const pressedThumb = (event.target as HTMLElement).closest('[data-provider-scroll-thumb]') !== null;
                if (!pressedThumb) {
                  const pointerOffset = event.clientX - trackRect.left;
                  const nextProgress = Math.min(
                    1,
                    Math.max(0, (pointerOffset - thumbWidth / 2) / trackScrollableWidth)
                  );
                  providerList.scrollLeft = nextProgress * providerScrollMetrics.maxScrollLeft;
                  updateProviderScrollMetrics();
                }
                providerScrollDragRef.current = {
                  pointerId: event.pointerId,
                  startClientX: event.clientX,
                  startScrollLeft: providerList.scrollLeft,
                  trackScrollableWidth,
                };
                event.currentTarget.setPointerCapture(event.pointerId);
                event.preventDefault();
                event.stopPropagation();
              }}
              onPointerMove={(event) => {
                const drag = providerScrollDragRef.current;
                const providerList = providerListRef.current;
                if (!drag || !providerList || drag.pointerId !== event.pointerId) {
                  return;
                }
                const scrollDelta = (event.clientX - drag.startClientX)
                  / drag.trackScrollableWidth
                  * providerScrollMetrics.maxScrollLeft;
                providerList.scrollLeft = Math.min(
                  providerScrollMetrics.maxScrollLeft,
                  Math.max(0, drag.startScrollLeft + scrollDelta)
                );
                updateProviderScrollMetrics();
              }}
              onPointerUp={(event) => {
                if (providerScrollDragRef.current?.pointerId !== event.pointerId) {
                  return;
                }
                providerScrollDragRef.current = null;
                event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onPointerCancel={() => {
                providerScrollDragRef.current = null;
              }}
              onKeyDown={(event) => {
                const providerList = providerListRef.current;
                if (!providerList) {
                  return;
                }
                const pageStep = Math.max(40, providerList.clientWidth * 0.7);
                let nextScrollLeft: number | null = null;
                if (event.key === 'ArrowLeft') nextScrollLeft = providerList.scrollLeft - 40;
                if (event.key === 'ArrowRight') nextScrollLeft = providerList.scrollLeft + 40;
                if (event.key === 'PageUp') nextScrollLeft = providerList.scrollLeft - pageStep;
                if (event.key === 'PageDown') nextScrollLeft = providerList.scrollLeft + pageStep;
                if (event.key === 'Home') nextScrollLeft = 0;
                if (event.key === 'End') nextScrollLeft = providerScrollMetrics.maxScrollLeft;
                if (nextScrollLeft === null) {
                  return;
                }
                event.preventDefault();
                event.stopPropagation();
                providerList.scrollLeft = Math.min(
                  providerScrollMetrics.maxScrollLeft,
                  Math.max(0, nextScrollLeft)
                );
                updateProviderScrollMetrics();
              }}
            >
              <div
                data-provider-scroll-thumb
                className="model-provider-scroll-thumb pointer-events-auto absolute bottom-0 cursor-grab rounded-full active:cursor-grabbing"
                style={{
                  left: `${providerScrollMetrics.thumbLeftPercent}%`,
                  width: `${providerScrollMetrics.thumbWidthPercent}%`,
                }}
              />
            </div>
          )}
        </div>
      </div>
      <div ref={listRef} data-model-list-scroll-region className={listClassName}>
        {filteredModels.map((model) => {
          const active = model.key === selectedModel?.key;

          return (
            <UiOptionButton
              ref={active ? selectedModelRef : undefined}
              key={model.key}
              active={active}
              variant="menu"
              className="w-full items-start gap-2.5 rounded-lg px-2.5 py-1.5"
              onClick={(event) => {
                event.stopPropagation();
                onModelChange(model.key);
              }}
            >
              {model.icon && (
                <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-lg text-text-muted ${active ? 'bg-white/15 text-white' : 'bg-bg-dark'}`}>
                  <img src={model.icon} alt="" className="h-full w-full object-cover" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className={`truncate text-13 ${active ? 'text-white' : 'text-text-dark'}`}>{model.displayName}</div>
                <div className={`truncate text-2xs ${active ? 'text-white/70' : 'text-text-muted'}`}>
                  {getModelDetail(model)}
                </div>
              </div>
              {active && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white" />}
            </UiOptionButton>
          );
        })}
        {filteredModels.length === 0 && (
          <div className="px-3 py-8 text-center text-xs text-text-muted">
            {emptyMessage ?? t('modelParams.noModels', { defaultValue: '没有匹配的模型' })}
          </div>
        )}
      </div>
    </div>
  );
}
