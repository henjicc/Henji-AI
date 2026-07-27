/** @vitest-environment jsdom */

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  UI_BOOLEAN_CONTROL_ACTIVE_CLASS,
  UI_MULTISELECT_ITEM_ACTIVE_CLASS,
  UI_NAV_INDICATOR_BOTTOM_CLASS,
  UI_NAV_INDICATOR_END_CLASS,
  UI_NAV_ITEM_ACTIVE_CLASS,
  UI_OPTION_ITEM_ACTIVE_CLASS,
} from './styleTokens';
import {
  UiCheckbox,
  UiChipButton,
  UiNavButton,
  UiOptionButton,
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
});
