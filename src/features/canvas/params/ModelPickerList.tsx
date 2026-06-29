import type { RefObject } from 'react';
import { Check, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { getI18nText } from '@/core/types/I18nText';
import type { ModelDefinition } from '@/core/types';
import { FILTERABLE_TAGS } from '@/core/types/ModelTags';
import {
  UI_COLOR_ACCENT_BG_CLASS,
  UI_COLOR_ACCENT_SOFT_BORDER_CLASS,
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
  /** floating：悬浮面板，列表固定上限高度；inline：节点内嵌正文，列表随可用空间伸展 */
  variant?: 'floating' | 'inline';
}

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
  variant = 'floating',
}: ModelPickerListProps) {
  const { t, i18n } = useTranslation();
  const { t: tModels } = useTranslation('models');
  const listClassName = variant === 'inline'
    ? 'ui-scrollbar mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1'
    : 'ui-scrollbar mt-2 max-h-[300px] space-y-1 overflow-y-auto pr-1';

  return (
    <div className={variant === 'inline' ? 'flex h-full min-h-0 w-full flex-col' : undefined}>
      <div className="space-y-2 border-b border-border-dark/70 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
          <UiInput
            ref={searchInputRef}
            type="text"
            value={modelSearchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
            placeholder={t('modelParams.searchPlaceholder', { defaultValue: '搜索模型名称、供应商或描述' })}
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
            className="!h-6 shrink-0 !rounded-md !px-2 !text-[11px]"
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
              className="!h-6 shrink-0 !rounded-md !px-2 !text-[11px]"
            >
              <span>{provider.label}</span>
              <span className="text-[10px] text-text-muted/80">{provider.count}</span>
            </UiChipButton>
          ))}
        </div>
      </div>
      <div className={listClassName}>
        {filteredModels.map((model) => {
          const active = model.meta.id === selectedModel?.meta.id;
          const displayName = getI18nText(model.meta.name, i18n.language) || model.meta.id;
          const functionLabels = getModelFunctionLabels(model, (tag) => tModels(`tags.${tag}`, { defaultValue: tag }));

          return (
            <UiOptionButton
              key={model.meta.id}
              active={active}
              className={`w-full items-start gap-2.5 rounded-lg px-2.5 py-1.5 ${
                active
                  ? `!${UI_COLOR_ACCENT_SOFT_BORDER_CLASS} !${UI_COLOR_ACCENT_BG_CLASS}`
                  : '!border-transparent !bg-transparent hover:!border-transparent hover:!bg-layer'
              }`}
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
                <div className={`truncate text-[13px] ${active ? 'text-white' : 'text-text-dark'}`}>{displayName}</div>
                <div className={`truncate text-[11px] ${active ? 'text-white/70' : 'text-text-muted'}`}>
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
