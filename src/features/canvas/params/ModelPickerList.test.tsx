// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProviderDisplayName } from '@/utils/modelHelpers';
import { ModelPickerList } from './ModelPickerList';
import type { ModelPickerOption } from './useModelPickerList';

const providerOptions = [
  { id: 'kie', label: 'KIE', count: 14 },
  { id: 'fal', label: 'Fal', count: 20 },
];

const models: ModelPickerOption[] = [
  { key: 'kie:nano-banana-2', displayName: 'Nano Banana 2', providerId: 'kie', providerName: 'KIE', detailLabels: ['图片生成', '图片编辑'] },
  { key: 'kie:z-image', displayName: 'Z-Image Turbo', providerId: 'kie', providerName: 'KIE', detailLabels: ['图片生成'] },
];

function renderPicker(providerFilter: string, variant: 'floating' | 'inline' = 'floating') {
  return render(
    <ModelPickerList
      variant={variant}
      modelSearchQuery=""
      onSearchChange={vi.fn()}
      providerFilter={providerFilter}
      onProviderFilterChange={vi.fn()}
      providerOptions={providerOptions}
      filteredModels={models}
      selectedModel={models[0]}
      onModelChange={vi.fn()}
    />
  );
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('画布节点模型选择（特殊面板）', () => {
  it('浮层头部只占一行：搜索与供应商下拉；正文是唯一滚动区，宽度按最长模型名量', () => {
    const view = renderPicker('all');
    const header = view.container.querySelector('[data-special-panel-header]');
    expect(header?.querySelector('input')).not.toBeNull();
    expect(header?.querySelectorAll('button').length).toBeGreaterThan(0);
    expect(view.container.querySelector('[role="scrollbar"]')).toBeNull();
    const body = view.container.querySelector('[data-special-panel-body]') as HTMLElement;
    expect(body.classList.contains('overflow-y-auto')).toBe(true);
    expect(body.style.width).not.toBe('');
  });

  it('全部供应商时说明里带供应商，选定供应商后不再重复写它', () => {
    // 量宽用的隐藏副本与列表写同一段说明
    expect(renderPicker('all').getAllByText('KIE · 图片生成 · 图片编辑').length).toBeGreaterThan(0);
    cleanup();
    const view = renderPicker('kie');
    expect(view.getAllByText('图片生成 · 图片编辑').length).toBeGreaterThan(0);
    expect(view.queryAllByText('KIE · 图片生成 · 图片编辑')).toHaveLength(0);
  });

  it('节点内嵌正文沿用同一个头部与列表，不套特殊面板外壳', () => {
    const view = renderPicker('all', 'inline');
    expect(view.container.querySelector('[data-special-panel]')).toBeNull();
    expect(view.container.querySelector('[data-model-picker-static-header] input')).not.toBeNull();
    expect(view.container.querySelector('[data-model-list-scroll-region]')?.classList.contains('overflow-y-auto')).toBe(true);
  });

  it('画布与生成页共用同一套供应商显示名', () => {
    expect(getProviderDisplayName('fal', 'zh-CN')).toBe('Fal');
    expect(getProviderDisplayName('FAL', 'en-US')).toBe('Fal');
    expect(getProviderDisplayName('VOLCENGINE', 'zh-CN')).toBe('火山引擎');
    expect(getProviderDisplayName('Modelscope', 'zh-CN')).toBe('魔搭');
    expect(getProviderDisplayName('PPIO', 'zh-CN')).toBe('派欧云');
    expect(getProviderDisplayName('bailian', 'zh-CN')).toBe('百炼');
    expect(getProviderDisplayName('bailian', 'en-US')).toBe('Alibaba Cloud Model Studio');
    expect(getProviderDisplayName('siliconflow', 'zh-CN')).toBe('硅基流动');
    expect(getProviderDisplayName('volcengine-speech', 'en-US')).toBe('Volcengine');
    expect(getProviderDisplayName('custom-provider', 'zh-CN')).toBe('custom-provider');
  });
});
