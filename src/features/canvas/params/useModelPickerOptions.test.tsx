// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type ModelPickerOption, useModelPickerOptions } from './useModelPickerList';

const options: ModelPickerOption[] = [
  {
    key: 'ppio\u0000gpt-alpha',
    displayName: 'Alpha 文本模型',
    providerId: 'ppio',
    providerName: 'PPIO',
    searchTerms: ['gpt-alpha'],
  },
  {
    key: 'bailian\u0000qwen-beta',
    displayName: '通义 Beta',
    providerId: 'bailian',
    providerName: '百炼',
    searchTerms: ['qwen-beta'],
  },
];

afterEach(cleanup);

describe('useModelPickerOptions', () => {
  it('groups speech and Ark in one brand filter while preserving their routing identities', () => {
    const serviceOptions = ['volcengine', 'volcengine-speech'].map(providerId => ({ key: providerId, displayName: providerId, providerId, providerName: '火山引擎' }));
    const { result } = renderHook(() => useModelPickerOptions({ options: [...options, ...serviceOptions], selectedKey: 'volcengine-speech' }));
    expect(result.current.providerOptions.filter(option => option.id === 'volcengine')).toEqual([{ id: 'volcengine', label: '火山引擎', count: 2 }]);
    act(() => result.current.setProviderFilter('volcengine'));
    expect(result.current.filteredModels.map(option => option.providerId)).toEqual(['volcengine', 'volcengine-speech']);
  });
  it('让文本模型与媒体模型共享供应商筛选、搜索和当前项解析', () => {
    const { result } = renderHook(() => useModelPickerOptions({
      options,
      selectedKey: 'bailian\u0000qwen-beta',
    }));

    expect(result.current.selectedModelOption?.displayName).toBe('通义 Beta');

    act(() => result.current.setProviderFilter('ppio'));
    expect(result.current.filteredModels.map((option) => option.key))
      .toEqual(['ppio\u0000gpt-alpha']);

    act(() => {
      result.current.setProviderFilter('all');
      result.current.setModelSearchQuery('qwen-beta');
    });
    expect(result.current.filteredModels.map((option) => option.key))
      .toEqual(['bailian\u0000qwen-beta']);
  });
});
