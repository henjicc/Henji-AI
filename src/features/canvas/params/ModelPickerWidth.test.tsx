// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ModelPickerList } from './ModelPickerList';
import type { ModelPickerOption } from './useModelPickerList';

const wideModels: ModelPickerOption[] = [{
  key: 'wide-model',
  displayName: '一个内容非常宽的模型名称',
  providerId: 'wide-provider',
  providerName: 'Wide Provider',
}];

const narrowModels: ModelPickerOption[] = [{
  key: 'narrow-model',
  displayName: '短模型',
  providerId: 'narrow-provider',
  providerName: 'Narrow',
}];

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', vi.fn(() => ({
    observe: vi.fn(),
    disconnect: vi.fn(),
  })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ModelPickerList 内容测宽', () => {
  it('供应商候选集从宽变窄时重新回报内容自身宽度', () => {
    let intrinsicWidth = 520;
    const onPreferredWidthChange = vi.fn();
    const view = render(
      <ModelPickerList
        modelSearchQuery=""
        onSearchChange={vi.fn()}
        providerFilter="wide-provider"
        onProviderFilterChange={vi.fn()}
        providerOptions={[{ id: 'wide-provider', label: 'Wide Provider', count: 1 }]}
        filteredModels={wideModels}
        modelsForWidthMeasurement={wideModels}
        selectedModel={wideModels[0]}
        onModelChange={vi.fn()}
        onPreferredWidthChange={onPreferredWidthChange}
      />
    );
    const measurementElement = view.container.querySelector('[aria-hidden="true"]');
    expect(measurementElement).not.toBeNull();
    Object.defineProperty(measurementElement!, 'scrollWidth', {
      configurable: true,
      get: () => intrinsicWidth,
    });

    // 首次重渲染模拟宽供应商完成布局测量。
    view.rerender(
      <ModelPickerList
        modelSearchQuery=""
        onSearchChange={vi.fn()}
        providerFilter="wide-provider"
        onProviderFilterChange={vi.fn()}
        providerOptions={[{ id: 'wide-provider', label: 'Wide Provider', count: 1 }]}
        filteredModels={wideModels}
        modelsForWidthMeasurement={[...wideModels]}
        selectedModel={wideModels[0]}
        onModelChange={vi.fn()}
        onPreferredWidthChange={onPreferredWidthChange}
      />
    );
    expect(onPreferredWidthChange).toHaveBeenLastCalledWith(520);

    intrinsicWidth = 248;
    view.rerender(
      <ModelPickerList
        modelSearchQuery=""
        onSearchChange={vi.fn()}
        providerFilter="narrow-provider"
        onProviderFilterChange={vi.fn()}
        providerOptions={[{ id: 'narrow-provider', label: 'Narrow', count: 1 }]}
        filteredModels={narrowModels}
        modelsForWidthMeasurement={narrowModels}
        selectedModel={narrowModels[0]}
        onModelChange={vi.fn()}
        onPreferredWidthChange={onPreferredWidthChange}
      />
    );

    expect(onPreferredWidthChange).toHaveBeenLastCalledWith(248);
  });
});
