import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PinyinMatch from 'pinyin-match';

import { registry } from '@/core/ModelRegistry';
import { getI18nText } from '@/core/types/I18nText';
import type { ModelTag } from '@/core/types';
import { FILTERABLE_TAGS } from '@/core/types/ModelTags';
import type { CanvasModelMediaType } from '@/features/canvas/domain/defaultModels';
import { getProviderDisplayName, resolveModelName } from '@/utils/modelHelpers';

export interface ProviderFilterOption {
  id: string;
  label: string;
  count: number;
}

/**
 * 画布模型选择器的统一展示契约。
 *
 * 图像/视频/音频模型来自 ModelRegistry，文本处理模型来自 LLM 配置；两边只在
 * 数据来源上不同，筛选、测宽、列表和选择态都应消费同一个展示结构。
 */
export interface ModelPickerOption {
  key: string;
  displayName: string;
  providerId: string;
  providerName: string;
  detailLabels?: string[];
  icon?: string;
  searchTerms?: string[];
}

function matchesModelSearch(option: ModelPickerOption, query: string): boolean {
  const keyword = query.trim();
  if (!keyword) {
    return true;
  }
  const haystack = [
    option.displayName,
    option.key,
    option.providerId,
    option.providerName,
    ...(option.detailLabels ?? []),
    ...(option.searchTerms ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const normalizedKeyword = keyword.toLowerCase();
  return haystack.includes(normalizedKeyword)
    || Boolean(PinyinMatch.match(option.displayName, keyword));
}

interface UseModelPickerOptionsOptions {
  options: ModelPickerOption[];
  selectedKey: string;
}

/** 任意模型来源共用的搜索、供应商筛选与当前项解析。 */
export function useModelPickerOptions({ options, selectedKey }: UseModelPickerOptionsOptions) {
  const { i18n } = useTranslation();
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const [providerFilter, setProviderFilter] = useState('all');

  const providerOptions = useMemo<ProviderFilterOption[]>(() => {
    const providers = new Map<string, ProviderFilterOption>();
    for (const option of options) {
      const existing = providers.get(option.providerId);
      if (existing) {
        existing.count += 1;
        continue;
      }
      providers.set(option.providerId, {
        id: option.providerId,
        label: option.providerName,
        count: 1,
      });
    }
    return Array.from(providers.values())
      .sort((a, b) => a.label.localeCompare(b.label, i18n.language));
  }, [i18n.language, options]);
  const providerModels = useMemo(
    () => providerFilter === 'all'
      ? options
      : options.filter((option) => option.providerId === providerFilter),
    [options, providerFilter]
  );
  const filteredModels = useMemo(
    () => providerModels.filter((option) => matchesModelSearch(option, modelSearchQuery)),
    [modelSearchQuery, providerModels]
  );
  const selectedModelOption = useMemo(
    () => options.find((option) => option.key === selectedKey)
      ?? options.find((option) => option.searchTerms?.includes(selectedKey))
      ?? options[0],
    [options, selectedKey]
  );

  // 媒体类型或 LLM 配置变化后，当前供应商可能已无候选项，统一回退到“全部”。
  useEffect(() => {
    if (providerFilter !== 'all' && !providerOptions.some((option) => option.id === providerFilter)) {
      setProviderFilter('all');
    }
  }, [providerFilter, providerOptions]);

  return {
    modelSearchQuery,
    setModelSearchQuery,
    providerFilter,
    setProviderFilter,
    providerModels,
    providerOptions,
    filteredModels,
    selectedModelOption,
  };
}

interface UseModelPickerListOptions {
  mediaType: CanvasModelMediaType;
  modelId: string;
  requiredTags?: ModelTag[];
}

/** ModelRegistry 模型到统一选择器展示契约的适配层。 */
export function useModelPickerList({ mediaType, modelId, requiredTags = [] }: UseModelPickerListOptions) {
  const { i18n } = useTranslation();
  const { t: tModels } = useTranslation('models');
  const models = useMemo(
    () => registry
      .getModelsByType(mediaType)
      .filter((model) => requiredTags.every((tag) => model.meta.tags?.includes(tag))),
    [mediaType, requiredTags]
  );
  const modelOptions = useMemo<ModelPickerOption[]>(() => models.map((model) => {
    const displayName = resolveModelName(model, i18n.language);
    const detailLabels = (model.meta.tags ?? [])
      .filter((tag) => FILTERABLE_TAGS.includes(tag))
      .map((tag) => tModels(`tags.${tag}`, { defaultValue: tag }));
    const description = model.meta.description
      ? getI18nText(model.meta.description, i18n.language)
      : '';

    return {
      key: model.meta.id,
      displayName,
      providerId: model.meta.provider,
      providerName: getProviderDisplayName(model.meta.provider, i18n.language),
      detailLabels,
      icon: model.meta.icon,
      searchTerms: [model.meta.id, description, ...(model.meta.aliases ?? [])],
    };
  }), [i18n.language, models, tModels]);
  const picker = useModelPickerOptions({ options: modelOptions, selectedKey: modelId });
  const selectedModel = useMemo(
    () => registry.getModel(picker.selectedModelOption?.key ?? modelId) ?? models[0],
    [modelId, models, picker.selectedModelOption?.key]
  );
  const selectedModelName = picker.selectedModelOption?.displayName ?? modelId;

  return {
    ...picker,
    models,
    selectedModel,
    selectedModelName,
  };
}
