/** @vitest-environment jsdom */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  UI_BOOLEAN_CONTROL_ACTIVE_CLASS,
  UI_COLOR_ACCENT_FILL_TEXT_CLASS,
  UI_GLASS_ADAPTIVE_CONTROL_CLASS,
  UI_GLASS_ADAPTIVE_OPTION_CLASS,
  UI_MULTISELECT_ITEM_ACTIVE_CLASS,
  UI_NAV_INDICATOR_BOTTOM_CLASS,
  UI_NAV_INDICATOR_END_CLASS,
  UI_NAV_ITEM_ACTIVE_CLASS,
  UI_OPTION_ITEM_ACTIVE_CLASS,
} from './styleTokens';
import {
  UiButton,
  UiCheckbox,
  UiChipButton,
  UiIconButton,
  UiNavButton,
  UiOptionButton,
  UiRangeInput,
  UiSwitch,
} from './primitives';

afterEach(cleanup);

function expectClasses(element: HTMLElement, classNames: string): void {
  for (const className of classNames.split(' ')) {
    expect(element.classList.contains(className)).toBe(true);
  }
}

describe('Ui primitives 选中态词汇表', () => {
  it('导航态使用中性底、强调文字与方向指示条', () => {
    const view = render(
      <>
        <UiNavButton active>纵向导航</UiNavButton>
        <UiChipButton active selectionRole="navigation">横向导航</UiChipButton>
      </>,
    );

    const vertical = view.getByRole('button', { name: '纵向导航' });
    const horizontal = view.getByRole('button', { name: '横向导航' });

    expectClasses(vertical, UI_NAV_ITEM_ACTIVE_CLASS);
    expectClasses(vertical, UI_NAV_INDICATOR_END_CLASS);
    expectClasses(horizontal, UI_NAV_ITEM_ACTIVE_CLASS);
    expectClasses(horizontal, UI_NAV_INDICATOR_BOTTOM_CLASS);
    expect(vertical.classList.contains('bg-surface-dark')).toBe(false);
    expect(horizontal.classList.contains('bg-surface-dark')).toBe(false);
  });

  it('单选项使用强实底，多选标签使用描边与中性底', () => {
    const view = render(
      <>
        <UiOptionButton active>当前值</UiOptionButton>
        <UiChipButton active>已选标签</UiChipButton>
      </>,
    );

    const option = view.getByRole('button', { name: '当前值' });
    const chip = view.getByRole('button', { name: '已选标签' });

    expectClasses(option, UI_OPTION_ITEM_ACTIVE_CLASS);
    expectClasses(chip, UI_MULTISELECT_ITEM_ACTIVE_CLASS);
    expect(option.classList.contains('bg-layer')).toBe(false);
    expect(chip.classList.contains('bg-brand-500')).toBe(false);
  });

  it('只有中性静息项携带玻璃内层自适应标记', () => {
    const view = render(
      <>
        <UiOptionButton>静息选项</UiOptionButton>
        <UiOptionButton active>选中选项</UiOptionButton>
        <UiChipButton>静息标签</UiChipButton>
        <UiChipButton active>选中标签</UiChipButton>
        <UiButton>中性动作</UiButton>
        <UiButton variant="primary">主动作</UiButton>
        <UiIconButton aria-label="中性图标动作" />
        <UiIconButton active aria-label="选中图标动作" />
        <UiIconButton appearance="hover-only" aria-label="静息工具栏动作" />
        <UiIconButton appearance="color-only" aria-label="纯图标反馈动作" />
      </>,
    );

    const idleOption = view.getByRole('button', { name: '静息选项' });
    expect(idleOption.classList.contains(UI_GLASS_ADAPTIVE_OPTION_CLASS)).toBe(true);
    expect(idleOption.classList.contains(UI_GLASS_ADAPTIVE_CONTROL_CLASS)).toBe(false);
    expect(idleOption.classList.contains('bg-surface-dark')).toBe(false);
    expect(view.getByRole('button', { name: '选中选项' }).classList.contains(UI_GLASS_ADAPTIVE_CONTROL_CLASS)).toBe(false);
    expect(view.getByRole('button', { name: '静息标签' }).classList.contains(UI_GLASS_ADAPTIVE_CONTROL_CLASS)).toBe(true);
    expect(view.getByRole('button', { name: '选中标签' }).classList.contains(UI_GLASS_ADAPTIVE_CONTROL_CLASS)).toBe(false);
    expect(view.getByRole('button', { name: '中性动作' }).classList.contains(UI_GLASS_ADAPTIVE_CONTROL_CLASS)).toBe(true);
    expect(view.getByRole('button', { name: '主动作' }).classList.contains(UI_GLASS_ADAPTIVE_CONTROL_CLASS)).toBe(false);
    expect(view.getByRole('button', { name: '中性图标动作' }).classList.contains(UI_GLASS_ADAPTIVE_CONTROL_CLASS)).toBe(true);
    expect(view.getByRole('button', { name: '选中图标动作' }).classList.contains(UI_GLASS_ADAPTIVE_CONTROL_CLASS)).toBe(false);
    expect(view.getByRole('button', { name: '静息工具栏动作' }).classList.contains(UI_GLASS_ADAPTIVE_CONTROL_CLASS)).toBe(false);
    expect(view.getByRole('button', { name: '纯图标反馈动作' }).classList.contains(UI_GLASS_ADAPTIVE_CONTROL_CLASS)).toBe(false);
  });

  it('纯图标反馈动作始终不添加背景，悬浮时只压暗图标', () => {
    const view = render(
      <UiIconButton appearance="color-only" aria-label="数字步进箭头" />,
    );

    const button = view.getByRole('button', { name: '数字步进箭头' });
    expect(button.className).not.toMatch(/(?:^|\s)(?:hover:|active:)?bg-/);
    expect(button.classList.contains('text-text-soft')).toBe(true);
    expect(button.classList.contains('hover:text-text-muted')).toBe(true);
    expect(button.classList.contains('active:text-text-faint')).toBe(true);
  });

  it('布尔态只强调开关与复选框控件本体', () => {
    const view = render(
      <>
        <UiSwitch checked aria-label="已开启" />
        <UiCheckbox checked aria-label="已勾选" />
      </>,
    );

    expectClasses(view.getByRole('switch', { name: '已开启' }), UI_BOOLEAN_CONTROL_ACTIVE_CLASS);
    expectClasses(view.getByRole('checkbox', { name: '已勾选' }), UI_BOOLEAN_CONTROL_ACTIVE_CLASS);
  });

  it('开关保留圆润默认外观，并支持带显式文案的双段外观', () => {
    const onCheckedChange = vi.fn();
    const view = render(
      <>
        <UiSwitch checked={false} aria-label="圆润开关" />
        <UiSwitch
          appearance="segmented"
          checked={false}
          offLabel="关"
          onLabel="开"
          aria-label="关闭的双段开关"
          onCheckedChange={onCheckedChange}
        />
        <UiSwitch
          appearance="segmented"
          checked
          offLabel="关"
          onLabel="开"
          size="compact"
          aria-label="开启的双段开关"
        />
      </>,
    );

    const pill = view.getByRole('switch', { name: '圆润开关' });
    const segmentedOff = view.getByRole('switch', { name: '关闭的双段开关' });
    const segmentedOn = view.getByRole('switch', { name: '开启的双段开关' });

    expect(pill.classList.contains('rounded-full')).toBe(true);
    expect(segmentedOff.classList.contains('rounded-lg')).toBe(true);
    expect(segmentedOff.classList.contains('bg-surface-dark')).toBe(true);
    expect(segmentedOff.textContent).toBe('关开');
    expect(segmentedOff.firstElementChild?.classList.contains('bg-layer')).toBe(true);
    expect(segmentedOff.firstElementChild?.classList.contains('translate-x-0')).toBe(true);
    expect(segmentedOff.firstElementChild?.classList.contains('transition-[transform,background-color]')).toBe(true);
    expect(segmentedOff.firstElementChild?.classList.contains('rounded-md')).toBe(true);
    expect(segmentedOff.firstElementChild?.classList.contains('inset-y-1')).toBe(true);
    expect(segmentedOff.firstElementChild?.classList.contains('duration-200')).toBe(true);
    expect(segmentedOn.firstElementChild?.classList.contains(UI_COLOR_ACCENT_FILL_TEXT_CLASS)).toBe(true);
    expect(segmentedOn.firstElementChild?.classList.contains('translate-x-full')).toBe(true);
    expect(segmentedOn.firstElementChild?.classList.contains('rounded')).toBe(true);
    expect(segmentedOn.firstElementChild?.classList.contains('inset-y-0.5')).toBe(true);
    expect(segmentedOn.classList.contains('h-7')).toBe(true);
    expect(segmentedOn.classList.contains('w-20')).toBe(true);
    expect(segmentedOn.classList.contains('rounded-md')).toBe(true);
    expect(segmentedOn.classList.contains('bg-surface-dark')).toBe(true);

    fireEvent.click(segmentedOff);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('精细控件保留至少 24 像素的命中高度', () => {
    const view = render(
      <>
        <UiCheckbox checked={false} aria-label="未勾选" />
        <UiRangeInput aria-label="范围" />
      </>,
    );

    expect(view.getByRole('checkbox', { name: '未勾选' }).classList.contains('h-6')).toBe(true);
    expect(view.getByRole('slider', { name: '范围' }).classList.contains('h-6')).toBe(true);
  });
});
