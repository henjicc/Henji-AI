/** @vitest-environment jsdom */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  UI_BOOLEAN_CONTROL_ACTIVE_CLASS,
  UI_COVER_GROUP_CLASS,
  UI_GLASS_ADAPTIVE_CONTROL_CLASS,
  UI_GLASS_ADAPTIVE_OPTION_CLASS,
  UI_GLASS_ADAPTIVE_SELECTED_CLASS,
  UI_GLASS_ADAPTIVE_TILE_CLASS,
  UI_MULTISELECT_ITEM_ACTIVE_CLASS,
  UI_NAV_INDICATOR_BOTTOM_CLASS,
  UI_NAV_INDICATOR_BOTTOM_SHORT_CLASS,
  UI_NAV_INDICATOR_BOTTOM_SUBTLE_CLASS,
  UI_NAV_INDICATOR_END_CLASS,
  UI_NAV_ITEM_ACTIVE_CLASS,
  UI_NAV_ITEM_ACTIVE_SUBTLE_CLASS,
  UI_OPTION_ITEM_ACTIVE_CLASS,
} from './styleTokens';
import {
  UiCheckbox,
  UiChipButton,
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

  it('克制型横向导航只收紧自身底色与指示条', () => {
    const view = render(
      <>
        <UiChipButton active selectionRole="navigation">默认导航</UiChipButton>
        <UiChipButton active selectionRole="navigation" selectionAppearance="subtle">
          克制导航
        </UiChipButton>
      </>,
    );

    const defaultNavigation = view.getByRole('button', { name: '默认导航' });
    const subtleNavigation = view.getByRole('button', { name: '克制导航' });

    expectClasses(defaultNavigation, UI_NAV_ITEM_ACTIVE_CLASS);
    expectClasses(defaultNavigation, UI_NAV_INDICATOR_BOTTOM_CLASS);
    expect(defaultNavigation.classList.contains('bg-surface-dark')).toBe(false);
    expectClasses(subtleNavigation, UI_NAV_ITEM_ACTIVE_SUBTLE_CLASS);
    expectClasses(subtleNavigation, UI_NAV_INDICATOR_BOTTOM_SUBTLE_CLASS);
    expect(subtleNavigation.className).not.toMatch(/(?:^|\s)bg-/);
  });

  it('标题栏工作区导航：28 高 13/500，选中中性底 + 主要文字 + 短指示条，静息无底', () => {
    const view = render(
      <>
        <UiChipButton active selectionRole="navigation" selectionAppearance="workspace" size="lg">生成</UiChipButton>
        <UiChipButton selectionRole="navigation" selectionAppearance="workspace">画布</UiChipButton>
      </>,
    );
    const active = view.getByRole('button', { name: '生成' });
    const rest = view.getByRole('button', { name: '画布' });

    expectClasses(active, UI_NAV_ITEM_ACTIVE_CLASS);
    expectClasses(active, UI_NAV_INDICATOR_BOTTOM_SHORT_CLASS);
    expectClasses(active, 'h-control-sm text-13 font-medium');
    expect(active.classList.contains('h-control-lg')).toBe(false);
    expectClasses(rest, `text-text2 ${UI_GLASS_ADAPTIVE_OPTION_CLASS}`);
    expect(rest.className).not.toMatch(/(?:^|\s)bg-|after:/);
  });

  it('工作区导航里的开关项：开启为中性选中底且无指示条，只写 aria-pressed；是当前页时不再是开关', () => {
    const view = render(
      <>
        <UiChipButton selectionRole="navigation" selectionAppearance="workspace" on>资产</UiChipButton>
        <UiChipButton selectionRole="navigation" selectionAppearance="workspace" on={false}>素材</UiChipButton>
        <UiChipButton active selectionRole="navigation" selectionAppearance="workspace" on={false}>当前</UiChipButton>
      </>,
    );
    const pressed = view.getByRole('button', { name: '资产' });
    expectClasses(pressed, UI_NAV_ITEM_ACTIVE_CLASS);
    expect(pressed.className).not.toMatch(/after:/);
    expect(pressed.getAttribute('aria-pressed')).toBe('true');
    expect(view.getByRole('button', { name: '素材' }).getAttribute('aria-pressed')).toBe('false');
    const current = view.getByRole('button', { name: '当前' });
    expect(current.getAttribute('aria-pressed')).toBeNull();
    expectClasses(current, UI_NAV_INDICATOR_BOTTOM_SHORT_CLASS);
  });

  it('单选项中性抬升，多选（标签与 selection="multiple" 的选项）用强调描边与强调文字', () => {
    const view = render(
      <>
        <UiOptionButton active>当前值</UiOptionButton>
        <UiOptionButton active selection="multiple">已选项</UiOptionButton>
        <UiChipButton active>已选标签</UiChipButton>
      </>,
    );

    const option = view.getByRole('button', { name: '当前值' });
    const multiple = view.getByRole('button', { name: '已选项' });
    const chip = view.getByRole('button', { name: '已选标签' });

    expectClasses(option, UI_OPTION_ITEM_ACTIVE_CLASS);
    expect(option.className).not.toMatch(/(^| )(bg|text|border)-(accent|brand)/);
    expectClasses(multiple, UI_MULTISELECT_ITEM_ACTIVE_CLASS);
    expectClasses(chip, UI_MULTISELECT_ITEM_ACTIVE_CLASS);
  });

  it('网格/卡片格的单选选中用淡强调底 + 强调文字，菜单项保持主要文字（重要记录 012）', () => {
    const view = render(
      <>
        <UiOptionButton active variant="grid">选中网格</UiOptionButton>
        <UiOptionButton active variant="menu">选中菜单项</UiOptionButton>
      </>,
    );
    expectClasses(view.getByRole('button', { name: '选中网格' }), `${UI_GLASS_ADAPTIVE_SELECTED_CLASS} text-accent-text border-transparent`);
    expectClasses(view.getByRole('button', { name: '选中菜单项' }), UI_OPTION_ITEM_ACTIVE_CLASS);
  });

  it('grid 选项格静息铺底不描边，键盘当前项显示悬停底', () => {
    const view = render(
      <>
        <UiOptionButton variant="grid">静息格子</UiOptionButton>
        <UiOptionButton variant="menu" highlighted>键盘当前项</UiOptionButton>
        <UiOptionButton variant="menu" size="sm">紧凑菜单项</UiOptionButton>
      </>,
    );
    const cell = view.getByRole('button', { name: '静息格子' });
    expectClasses(cell, `${UI_GLASS_ADAPTIVE_TILE_CLASS} ${UI_GLASS_ADAPTIVE_OPTION_CLASS} border-transparent`);
    expect(cell.className).not.toMatch(/veil/);
    expect(view.getByRole('button', { name: '键盘当前项' }).classList.contains('ui-option-highlighted')).toBe(true);
    const compact = view.getByRole('button', { name: '紧凑菜单项' });
    expectClasses(compact, 'min-h-control-sm text-xs');
    expect(compact.dataset.size).toBe('sm');
  });

  it('分段、选项格与色样的选中是淡强调底 + 强调文字，不用强调色实底（重要记录 012）', () => {
    const view = render(
      <>
        <UiOptionButton variant="segment" active>选中段</UiOptionButton>
        <UiOptionButton variant="segment">静息段</UiOptionButton>
        <UiOptionButton variant="tile" active>选中格</UiOptionButton>
        <UiOptionButton variant="tile">静息格</UiOptionButton>
        <UiOptionButton variant="swatch" active aria-label="选中色样" />
        <UiOptionButton variant="swatch" aria-label="静息色样" />
      </>,
    );
    const activeSegment = view.getByRole('button', { name: '选中段' });
    const restSegment = view.getByRole('button', { name: '静息段' });
    const activeTile = view.getByRole('button', { name: '选中格' });
    const restTile = view.getByRole('button', { name: '静息格' });
    const activeSwatch = view.getByRole('button', { name: '选中色样' });
    const restSwatch = view.getByRole('button', { name: '静息色样' });

    // 重要记录 012（任务 4.3）：选中 = 淡强调底（ui-glass-adaptive-selected → --selected-accent）+ 强调文字，
    // 不用强调色实底，也不描强调边
    for (const active of [activeSegment, activeTile]) {
      expectClasses(active, `${UI_GLASS_ADAPTIVE_SELECTED_CLASS} text-accent-text border-transparent`);
      expect(active.className).not.toMatch(/(^| )(bg-accent|border-accent|bg-brand)/);
    }
    expectClasses(restSegment, `${UI_GLASS_ADAPTIVE_OPTION_CLASS} text-text2`);
    expect(restSegment.classList.contains(UI_GLASS_ADAPTIVE_SELECTED_CLASS)).toBe(false);
    expectClasses(restTile, `${UI_GLASS_ADAPTIVE_TILE_CLASS} ${UI_GLASS_ADAPTIVE_OPTION_CLASS} text-text2`);
    expectClasses(activeSwatch, 'rounded-full bg-clip-content border-text1');
    expectClasses(restSwatch, 'border-transparent');
    expect(activeSwatch.className).not.toMatch(/(^| )bg-(?!clip-)/);
  });

  it('只有中性静息项携带玻璃内层自适应标记', () => {
    const view = render(
      <>
        <UiOptionButton>静息选项</UiOptionButton>
        <UiOptionButton active>选中选项</UiOptionButton>
        <UiChipButton>静息标签</UiChipButton>
        <UiChipButton active>选中标签</UiChipButton>
      </>,
    );

    const idleOption = view.getByRole('button', { name: '静息选项' });
    expect(idleOption.classList.contains(UI_GLASS_ADAPTIVE_OPTION_CLASS)).toBe(true);
    expect(idleOption.classList.contains(UI_GLASS_ADAPTIVE_CONTROL_CLASS)).toBe(false);
    expect(idleOption.classList.contains('bg-surface-dark')).toBe(false);
    expect(view.getByRole('button', { name: '选中选项' }).classList.contains(UI_GLASS_ADAPTIVE_CONTROL_CLASS)).toBe(false);
    // 纯文字标签：静息一圈发丝线，悬停交给玻璃自适应的 option 底（不铺控件实底）
    expect(view.getByRole('button', { name: '静息标签' }).classList.contains(UI_GLASS_ADAPTIVE_OPTION_CLASS)).toBe(true);
    expect(view.getByRole('button', { name: '静息标签' }).classList.contains('border-line-strong')).toBe(true);
    expect(view.getByRole('button', { name: '选中标签' }).classList.contains(UI_GLASS_ADAPTIVE_CONTROL_CLASS)).toBe(false);
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
    expect(pill.classList.contains('bg-control-pressed')).toBe(true);
    // 双段外观与分段选择同一套选中：轨道更暗、滑块是淡强调底、当前侧文字为强调文字，不用强调色实底（重要记录 012）
    expect(segmentedOff.classList.contains('rounded-lg')).toBe(true);
    expect(segmentedOff.classList.contains('bg-gap/60')).toBe(true);
    expect(segmentedOff.textContent).toBe('关开');
    expect(segmentedOff.firstElementChild?.classList.contains(UI_GLASS_ADAPTIVE_SELECTED_CLASS)).toBe(true);
    expect(segmentedOff.firstElementChild?.classList.contains('translate-x-0')).toBe(true);
    expect(segmentedOff.firstElementChild?.classList.contains('duration-180')).toBe(true);
    expect(segmentedOn.firstElementChild?.classList.contains(UI_GLASS_ADAPTIVE_SELECTED_CLASS)).toBe(true);
    expect(segmentedOn.firstElementChild?.className).not.toMatch(/(^| )bg-accent/);
    expect(segmentedOn.lastElementChild?.classList.contains('text-accent-text')).toBe(true);
    expect(segmentedOff.children[1]?.classList.contains('text-accent-text')).toBe(true);
    expect(segmentedOn.firstElementChild?.classList.contains('translate-x-full')).toBe(true);
    expect(segmentedOn.classList.contains('h-control-sm')).toBe(true);
    expect(segmentedOn.classList.contains('w-20')).toBe(true);

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

describe('UiOptionButton variant="cover"（封面内容卡，界面重设计 3.3）', () => {
  afterEach(cleanup);

  it('按钮本身无底无框，选中只经 data-selected 交给封面框表达', () => {
    const view = render(
      <>
        <UiOptionButton variant="cover" aria-label="静息卡">静息</UiOptionButton>
        <UiOptionButton variant="cover" active aria-label="选中卡">选中</UiOptionButton>
      </>,
    );
    const rest = view.getByRole('button', { name: '静息卡' });
    const selected = view.getByRole('button', { name: '选中卡' });
    expect(rest.classList.contains(UI_COVER_GROUP_CLASS)).toBe(true);
    expect(rest.getAttribute('data-selected')).toBe('false');
    expect(selected.getAttribute('data-selected')).toBe('true');
    for (const button of [rest, selected]) {
      expect(button.classList.contains('bg-transparent')).toBe(true);
      expect(button.classList.contains('border-0')).toBe(true);
      expect([...button.classList].some((name) => name.startsWith('bg-') && name !== 'bg-transparent')).toBe(false);
    }
  });
});
