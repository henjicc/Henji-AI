import { UI_ICON_SIZE_CLASS } from '@/components/ui/styleTokens'
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  Dropdown,
  UiFieldLayoutContext,
  UiOptionButton,
  UiSearchInput,
  UiSpecialPanel,
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
  /** 浮层宽度按当前供应商的完整候选集测量，搜索时宽度不跟着缩 */
  modelsForWidthMeasurement?: ModelPickerOption[];
  /** 面板打开时，将当前模型尽可能垂直居中到列表视口 */
  revealSelectedModel?: boolean;
  /** floating：特殊面板（浮层）；inline：节点内嵌正文，列表随可用空间伸展 */
  variant?: 'floating' | 'inline';
  /** 能力约束筛掉全部候选时展示的稳定原因；搜索无结果仍使用通用文案。 */
  emptyMessage?: string;
}

/** 行内留白 10 × 2 + 勾 14 + 间距 12 + 列表留白 6 × 2 + 量取余量 */
const MODEL_ROW_HORIZONTAL_CHROME = 20 + 14 + 12 + 12 + 4;

function getModelDetail(option: ModelPickerOption, withProvider: boolean): string {
  return [...(withProvider ? [option.providerName] : []), ...(option.detailLabels ?? [])].join(' · ');
}

/**
 * 画布节点的模型选择（特殊面板，重要记录 021）：头部一行搜索与供应商下拉，正文单列列表。
 * 浮层宽度量最长的模型名称与说明；已按供应商筛选时列表不再重复写供应商。浮层与节点内嵌正文共用。
 */
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
  revealSelectedModel = false,
  variant = 'floating',
  emptyMessage,
}: ModelPickerListProps) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement>(null);
  const selectedModelRef = useRef<HTMLButtonElement>(null);
  const widthMeasurementRef = useRef<HTMLDivElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState<number | undefined>(undefined);
  const withProvider = providerFilter === 'all';
  const measuredModels = modelsForWidthMeasurement ?? filteredModels;
  const floating = variant === 'floating';

  useLayoutEffect(() => {
    if (!revealSelectedModel) {
      return;
    }
    const listElement = listRef.current?.closest('[data-special-panel-body]') as HTMLElement | null ?? listRef.current;
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
    if (!floating || !measurementElement) {
      return;
    }
    const report = (): void => setMeasuredWidth(Math.ceil(measurementElement.scrollWidth) + MODEL_ROW_HORIZONTAL_CHROME);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(measurementElement);
    return () => observer.disconnect();
  }, [floating, measuredModels, withProvider]);

  const header = (
    <UiFieldLayoutContext.Provider value="toolbar">
      <UiSearchInput
        ref={searchInputRef}
        value={modelSearchQuery}
        onChange={(event) => onSearchChange(event.target.value)}
        textHistory={{ onValueChange: onSearchChange }}
        onKeyDown={(event) => event.stopPropagation()}
        placeholder={t('modelParams.searchModels', { defaultValue: '搜索模型' })}
        aria-label={t('modelParams.searchModels', { defaultValue: '搜索模型' })}
        size="sm"
        clearLabel={t('modelParams.clearSearch', { defaultValue: '清空搜索' })}
        onClear={() => onSearchChange('')}
        className="min-w-32 flex-1"
      />
      {providerOptions.length > 1 ? (
        <Dropdown
          size="sm"
          ariaLabel={t('modelParams.provider', { defaultValue: '供应商' })}
          value={providerFilter}
          options={[
            { label: t('modelParams.allProviders', { defaultValue: '全部' }), value: 'all' },
            ...providerOptions.map(provider => ({ label: `${provider.label} ${provider.count}`, value: provider.id })),
          ]}
          onSelect={onProviderFilterChange}
        />
      ) : null}
    </UiFieldLayoutContext.Provider>
  );

  const list = (
    <div ref={listRef} data-model-list-scroll-region className={floating ? 'flex flex-col gap-0.5' : 'mt-2 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pr-1'}>
      {filteredModels.map((model) => {
        const active = model.key === selectedModel?.key;
        return (
          <UiOptionButton
            ref={active ? selectedModelRef : undefined}
            key={model.key}
            active={active}
            variant="menu"
            className="w-full items-start gap-3"
            onClick={(event) => {
              event.stopPropagation();
              onModelChange(model.key);
            }}
          >
            {model.icon && (
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gap text-text2">
                <img src={model.icon} alt="" className="h-full w-full object-cover" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-13 text-text1">{model.displayName}</div>
              {getModelDetail(model, withProvider) ? (
                <div className="truncate text-2xs text-text3">{getModelDetail(model, withProvider)}</div>
              ) : null}
            </div>
            {active && <Check className={`${UI_ICON_SIZE_CLASS.sm} mt-0.5 shrink-0 text-accent-text`} />}
          </UiOptionButton>
        );
      })}
      {filteredModels.length === 0 && (
        <div className="px-3 py-8 text-center text-xs text-text2">
          {emptyMessage ?? t('modelParams.noModels', { defaultValue: '没有匹配的模型' })}
        </div>
      )}
    </div>
  );

  const measurement: ReactNode = floating ? (
    <div ref={widthMeasurementRef} aria-hidden className="pointer-events-none invisible fixed left-0 top-0 -z-raised flex w-max flex-col items-start">
      {measuredModels.map((model) => (
        <div key={model.key} className="inline-flex items-start gap-3">
          {model.icon && <span className="h-7 w-7 shrink-0" />}
          <div className="flex flex-col">
            <span className="whitespace-nowrap text-13">{model.displayName}</span>
            <span className="whitespace-nowrap text-2xs">{getModelDetail(model, withProvider)}</span>
          </div>
        </div>
      ))}
    </div>
  ) : null;

  if (!floating) {
    return (
      <div className="flex h-full min-h-0 w-full flex-col">
        <div data-model-picker-static-header className="flex shrink-0 items-center gap-2 border-b border-line/70 pb-2">{header}</div>
        {list}
      </div>
    );
  }

  return (
    <UiSpecialPanel className="nodrag nowheel" header={header} bodyPadding="none" bodyWidth={measuredWidth}>
      {measurement}
      <div className="p-1.5">{list}</div>
    </UiSpecialPanel>
  );
}
