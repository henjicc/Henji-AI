import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PinyinMatch from 'pinyin-match';

import { registry } from '@/core/ModelRegistry';
import { getI18nText } from '@/core/types/I18nText';
import type { ModelDefinition, ModelTag } from '@/core/types';
import {
  getProviderDisplayName,
  type CanvasModelMediaType,
} from '@/features/canvas/domain/defaultModels';

export interface ProviderFilterOption {
  id: string;
  label: string;
  count: number;
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

interface UseModelPickerListOptions {
  mediaType: CanvasModelMediaType;
  modelId: string;
  requiredTags?: ModelTag[];
}

/** 模型选择面板的搜索/筛选状态与候选列表计算，被悬浮面板与节点内嵌正文共用 */
export function useModelPickerList({ mediaType, modelId, requiredTags = [] }: UseModelPickerListOptions) {
  const { i18n } = useTranslation();
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const [providerFilter, setProviderFilter] = useState('all');

  const models = useMemo(
    () => registry
      .getModelsByType(mediaType)
      .filter((model) => requiredTags.every((tag) => model.meta.tags?.includes(tag))),
    [mediaType, requiredTags]
  );
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

  // 媒体类型切换等场景可能导致当前筛选的供应商不再有候选模型，自动回退到"全部"
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
    models,
    providerOptions,
    filteredModels,
    selectedModel,
    selectedModelName,
  };
}
