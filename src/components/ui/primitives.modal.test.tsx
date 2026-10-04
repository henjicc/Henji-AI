/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UiButton, UiInput } from './primitives';
import { UiModal } from './UiModal';
import Dropdown from './Dropdown';
import { UI_MODAL_SIZE_CLASS, type UiModalSize } from './styleTokens';

afterEach(cleanup);

describe('UiModal', () => {
  it('提供对话框语义，打开时接管焦点并在关闭后还原', async () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    const onClose = vi.fn();
    const view = render(
      <UiModal isOpen title="设置" onClose={onClose}>
        <UiInput autoFocus aria-label="内容输入框" />
      </UiModal>,
    );

    const dialog = view.getByRole('dialog', { name: '设置' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(dialog));

    view.rerender(
      <UiModal isOpen={false} title="设置" onClose={onClose}>
        <UiInput autoFocus aria-label="内容输入框" />
      </UiModal>,
    );
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    trigger.remove();
  });

  it('只让栈顶弹窗响应 Esc', () => {
    const closeParent = vi.fn();
    const closeChild = vi.fn();
    render(
      <>
        <UiModal isOpen title="父弹窗" onClose={closeParent}>
          父弹窗内容
        </UiModal>
        <UiModal isOpen title="子弹窗" onClose={closeChild}>
          子弹窗内容
        </UiModal>
      </>,
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(closeChild).toHaveBeenCalledTimes(1);
    expect(closeParent).not.toHaveBeenCalled();
  });

  it('弹窗里打开的下拉按 Esc 只收起下拉，不连带关掉弹窗（5.6 第二批 B-41）', async () => {
    const onClose = vi.fn();
    const view = render(
      <UiModal isOpen title="设置" onClose={onClose}>
        <Dropdown value="a" options={[{ value: 'a', label: '自动' }, { value: 'b', label: '简体中文' }]} onSelect={vi.fn()} />
      </UiModal>,
    );
    const trigger = view.getByRole('button', { name: /自动/ });
    fireEvent.click(trigger);
    expect(await view.findByRole('listbox')).toBeTruthy();

    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('在首尾可聚焦元素之间循环 Tab', async () => {
    const view = render(
      <UiModal isOpen title="焦点循环" onClose={vi.fn()}>
        <UiButton type="button">第一个</UiButton>
        <UiButton type="button">最后一个</UiButton>
      </UiModal>,
    );
    const first = view.getByRole('button', { name: '焦点循环 - 关闭' });
    const last = view.getByRole('button', { name: '最后一个' });

    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('隐藏标题栏时仍使用标题作为可访问名称', () => {
    const view = render(
      <UiModal isOpen hideHeader title="无标题栏弹窗" onClose={vi.fn()}>
        内容
      </UiModal>,
    );

    expect(view.getByRole('dialog', { name: '无标题栏弹窗' })).not.toBeNull();
  });

  it('支持在标题旁放置轻量上下文动作', () => {
    const view = render(
      <UiModal
        isOpen
        title="首次设置"
        headerActions={<UiButton>简体中文</UiButton>}
        onClose={vi.fn()}
      >
        内容
      </UiModal>,
    );

    expect(view.getByRole('button', { name: '简体中文' })).not.toBeNull();
  });

  it('所有尺寸档位都使用统一的响应式尺寸令牌', () => {
    const sizes = Object.keys(UI_MODAL_SIZE_CLASS) as UiModalSize[];
    const view = render(
      <UiModal isOpen title="尺寸测试" onClose={vi.fn()}>
        内容
      </UiModal>,
    );

    for (const size of sizes) {
      view.rerender(
        <UiModal isOpen title="尺寸测试" onClose={vi.fn()} size={size}>
          内容
        </UiModal>,
      );
      const dialog = view.getByRole('dialog', { name: '尺寸测试' });
      const panel = dialog.children.item(1);
      expect(panel?.className).toContain(UI_MODAL_SIZE_CLASS[size]);
    }
  });
});

describe('UiModal 收起（任务 5.8，同 VE-06）', () => {
  it('收起中不可点击、对读屏隐藏；退出过渡结束即卸载，不必等计时器', () => {
    vi.useFakeTimers();
    try {
      const onClose = vi.fn();
      const view = render(
        <UiModal isOpen title="确认" onClose={onClose}>
          <UiButton>确定</UiButton>
        </UiModal>,
      );
      view.rerender(
        <UiModal isOpen={false} title="确认" onClose={onClose}>
          <UiButton>确定</UiButton>
        </UiModal>,
      );
      const root = document.body.querySelector('[data-dialog="true"]') as HTMLElement;
      expect(root.getAttribute('aria-hidden')).toBe('true');
      expect(root.hasAttribute('inert')).toBe(true);
      const panel = root.querySelector('.transition-opacity.duration-180:not(.ui-glass-scrim)') as HTMLElement;
      fireEvent.transitionEnd(panel);
      expect(document.body.querySelector('[data-dialog="true"]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
