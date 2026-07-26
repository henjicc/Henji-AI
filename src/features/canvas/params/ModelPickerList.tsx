import { useLayoutEffect, useRef, type RefObject } from 'react';
import { Check, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { getI18nText } from '@/core/types/I18nText';
import type { ModelDefinition } from '@/core/types';
import { FILTERABLE_TAGS } from '@/core/types/ModelTags';
import {
  UiChipButton,
  UiIconButton,
  UiInput,
  UiOptionButton,
} from '@/components/ui';
import { getProviderDisplayName } from '@/features/canvas/domain/defaultModels';
import type { ProviderFilterOption } from './useModelPickerList';

interface ModelPickerListProps {
  modelSearchQuery: string;
  onSearchChange: (value: string) => void;
  searchInputRef?: RefObject<HTMLInputElement>;
  providerFilter: string;
  onProviderFilterChange: (id: string) => void;
  providerOptions: ProviderFilterOption[];
  filteredModels: ModelDefinition[];
  selectedModel: ModelDefinition | undefined;
  onModelChange: (modelId: string) => void;
  /** 浮层宽度按当前供应商的完整候选集测量，搜索时保持稳定 */
  modelsForWidthMeasurement?: ModelDefinition[];
  onPreferredWidthChange?: (width: number) => void;
  /** 面板打开时，将当前模型尽可能垂直居中到列表视口 */
  revealSelectedModel?: boolean;
  /** floating：悬浮面板，列表固定上限高度；inline：节点内嵌正文，列表随可用空间伸展 */
  variant?: 'floating' | 'inline';
}

const MODEL_LIST_SCROLLBAR_CHROME = 11;

function getModelFunctionLabels(model: ModelDefinition, translateTag: (tag: string) => string): string[] {
  return (model.meta.tags ?? [])
    .filter((tag) => FILTERABLE_TAGS.includes(tag))
    .map((tag) => translateTag(tag));
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
}: ModelPickerListProps) {
  const { t, i18n } = useTranslation();
  const { t: tModels } = useTranslation('models');
  const listRef = useRef<HTMLDivElement>(null);
  const selectedModelRef = useRef<HTMLButtonElement>(null);
  const widthMeasurementRef = useRef<HTMLDivElement>(null);
  const searchPlaceholder = t('modelParams.searchPlaceholder', { defaultValue: '搜索模型名称、供应商或描述' });
  const measuredModels = modelsForWidthMeasurement ?? filteredModels;
  const listClassName = variant === 'inline'
    ? 'ui-scrollbar mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1'
    : 'ui-scrollbar mt-2 max-h-[300px] space-y-1 overflow-y-auto pr-1';

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
  }, [revealSelectedModel, selectedModel?.meta.id]);

  useLayoutEffect(() => {
    const measurementElement = widthMeasurementRef.current;
    if (!measurementElement || !onPreferredWidthChange) {
      return;
    }
    const reportWidth = (): void => {
      onPreferredWidthChange(Math.ceil(measurementElement.getBoundingClientRect().width));
    };
    reportWidth();
    const observer = new ResizeObserver(reportWidth);
    observer.observe(measurementElement);
    return () => observer.disconnect();
  }, [onPreferredWidthChange]);

  return (
    <div className={variant === 'inline' ? 'flex h-full min-h-0 w-full flex-col' : 'relative'}>
      {onPreferredWidthChange && (
        <div
          ref={widthMeasurementRef}
          aria-hidden
          className="pointer-events-none invisible fixed left-0 top-0 -z-10 flex w-max flex-col items-start"
        >
          <div className="whitespace-nowrap border border-transparent px-8 text-xs">{searchPlaceholder}</div>
          <div className="mt-2 inline-flex gap-1">
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
            {measuredModels.map((model) => {
              const displayName = getI18nText(model.meta.name, i18n.language) || model.meta.id;
              const functionLabels = getModelFunctionLabels(model, (tag) => tModels(`tags.${tag}`, { defaultValue: tag }));

              return (
                <div key={model.meta.id} className="inline-flex items-start gap-2.5 border border-transparent px-2.5 py-1.5">
                  {model.meta.icon && <span className="h-7 w-7 shrink-0" />}
                  <div className="flex flex-col">
                    <span className="whitespace-nowrap text-13">{displayName}</span>
                    <span className="whitespace-nowrap text-2xs">
                      {getProviderDisplayName(model.meta.provider)}
                      {functionLabels.length > 0 ? ` · ${functionLabels.join(' · ')}` : ''}
                    </span>
                  </div>
                  <Check className="h-3.5 w-3.5 shrink-0" />
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="space-y-2 border-b border-border-dark/70 pb-2">
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
        <div className="ui-scrollbar flex max-w-full gap-1 overflow-x-auto pb-0.5">
          <UiChipButton
            type="button"
            active={providerFilter === 'all'}
            onClick={(event) => {
              event.stopPropagation();
              onProviderFilterChange('all');
            }}
            className="!h-6 shrink-0 !rounded-md !px-2 !text-2xs"
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
                onProviderFilterChange(provider.id);
              }}
              className="!h-6 shrink-0 !rounded-md !px-2 !text-2xs"
            >
              <span>{provider.label}</span>
              <span className="text-3xs text-text-muted/80">{provider.count}</span>
            </UiChipButton>
          ))}
        </div>
      </div>
      <div ref={listRef} className={listClassName}>
        {filteredModels.map((model) => {
          const active = model.meta.id === selectedModel?.meta.id;
          const displayName = getI18nText(model.meta.name, i18n.language) || model.meta.id;
          const functionLabels = getModelFunctionLabels(model, (tag) => tModels(`tags.${tag}`, { defaultValue: tag }));

          return (
            <UiOptionButton
              ref={active ? selectedModelRef : undefined}
              key={model.meta.id}
              active={active}
              variant="menu"
              className="w-full items-start gap-2.5 rounded-lg px-2.5 py-1.5"
              onClick={(event) => {
                event.stopPropagation();
                onModelChange(model.meta.id);
              }}
            >
              {model.meta.icon && (
                <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-lg text-text-muted ${active ? 'bg-white/15 text-white' : 'bg-bg-dark'}`}>
                  <img src={model.meta.icon} alt="" className="h-full w-full object-cover" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className={`truncate text-13 ${active ? 'text-white' : 'text-text-dark'}`}>{displayName}</div>
                <div className={`truncate text-2xs ${active ? 'text-white/70' : 'text-text-muted'}`}>
                  {getProviderDisplayName(model.meta.provider)}
                  {functionLabels.length > 0 ? ` · ${functionLabels.join(' · ')}` : ''}
                </div>
              </div>
              {active && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white" />}
            </UiOptionButton>
          );
        })}
        {filteredModels.length === 0 && (
          <div className="px-3 py-8 text-center text-xs text-text-muted">
            {t('modelParams.noModels', { defaultValue: '没有匹配的模型' })}
          </div>
        )}
      </div>
    </div>
  );
}
