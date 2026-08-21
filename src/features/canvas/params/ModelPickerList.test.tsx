// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getProviderDisplayName } from '@/features/canvas/domain/defaultModels';
import { ModelPickerList } from './ModelPickerList';

const providerOptions = [
  { id: 'apimart', label: 'APIMART', count: 9 },
  { id: 'bailian', label: 'BAILIAN', count: 2 },
  { id: 'fal', label: 'Fal', count: 12 },
  { id: 'kie', label: 'KIE', count: 12 },
  { id: 'modelscope', label: 'ModelScope', count: 7 },
];

function renderPicker(providerFilter: string) {
  return render(
    <ModelPickerList
      modelSearchQuery=""
      onSearchChange={vi.fn()}
      providerFilter={providerFilter}
      onProviderFilterChange={vi.fn()}
      providerOptions={providerOptions}
      filteredModels={[]}
      selectedModel={undefined}
      onModelChange={vi.fn()}
    />
  );
}

afterEach(cleanup);

describe('ModelPickerList 供应商横向导航', () => {
  it('当前供应商使用单选项语义并同步强调数量', () => {
    const view = renderPicker('bailian');
    const activeProvider = view.getByRole('button', { name: /BAILIAN\s*2/ });
    const inactiveProvider = view.getByRole('button', { name: /APIMART\s*9/ });

    expect(activeProvider.getAttribute('aria-pressed')).toBe('true');
    expect(inactiveProvider.getAttribute('aria-pressed')).toBe('false');
    expect(activeProvider.lastElementChild?.classList.contains('text-white/70')).toBe(true);
    expect(inactiveProvider.lastElementChild?.classList.contains('text-white/70')).toBe(false);
  });

  it('供应商切换后把当前项带入可视区域中央', () => {
    const view = renderPicker('all');
    const allButton = view.getByRole('button', { name: /^(All|全部)$/ }).closest('button');
    const providerList = allButton?.parentElement;
    const kieButton = view.getByText('KIE').closest('button');

    expect(providerList).not.toBeNull();
    expect(kieButton).not.toBeNull();
    Object.defineProperties(providerList!, {
      clientWidth: { configurable: true, value: 180 },
      scrollWidth: { configurable: true, value: 520 },
      scrollLeft: { configurable: true, value: 0, writable: true },
    });
    Object.defineProperties(kieButton!, {
      offsetLeft: { configurable: true, value: 300 },
      offsetWidth: { configurable: true, value: 72 },
    });

    view.rerender(
      <ModelPickerList
        modelSearchQuery=""
        onSearchChange={vi.fn()}
        providerFilter="kie"
        onProviderFilterChange={vi.fn()}
        providerOptions={providerOptions}
        filteredModels={[]}
        selectedModel={undefined}
        onModelChange={vi.fn()}
      />
    );

    expect(providerList!.scrollLeft).toBe(246);
    const scrollbar = view.getByRole('scrollbar');
    expect(scrollbar).toBeTruthy();

    fireEvent.keyDown(scrollbar, { key: 'End' });

    expect(providerList!.scrollLeft).toBe(340);
  });

  it('鼠标纵向滚轮可直接驱动横向供应商列表', () => {
    const view = renderPicker('all');
    const providerList = view.getByRole('button', { name: /^(All|全部)$/ }).parentElement;

    expect(providerList).not.toBeNull();
    Object.defineProperties(providerList!, {
      clientWidth: { configurable: true, value: 180 },
      scrollWidth: { configurable: true, value: 520 },
      scrollLeft: { configurable: true, value: 0, writable: true },
    });

    fireEvent.wheel(providerList!, { deltaX: 0, deltaY: 48 });

    expect(providerList!.scrollLeft).toBe(48);
  });

  it('中文环境下使用“百炼”作为简短供应商名', () => {
    expect(getProviderDisplayName('bailian', 'zh-CN')).toBe('百炼');
    expect(getProviderDisplayName('bailian', 'en-US')).toBe('Bailian');
  });
});
