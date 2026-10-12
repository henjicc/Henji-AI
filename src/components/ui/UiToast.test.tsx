/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationProvider, useNotification } from '@/contexts/NotificationContext';
import { useToast } from '@/workspaces/GenerationWorkspace/hooks/useToast';
import { UI_TOAST_DISPLAY_MS, UI_TOAST_EXIT_MS } from './motion';
import { UiToast } from './UiToast';
import i18n from '@/i18n/config';
import { notificationMessage } from '@/i18n/notifications';

afterEach(cleanup);

describe('UiToast（通知提示唯一实现，任务 5.7）', () => {
  it('系统提示在显示期间跟随语言切换，用户文字保持原样', async () => {
    const previous = i18n.language;
    await i18n.changeLanguage('zh-CN');
    const view = render(<UiToast message={notificationMessage('saved')} tone="success" />);
    expect(view.getByRole('status').textContent).toBe('已保存');
    await act(() => i18n.changeLanguage('en-US'));
    expect(view.getByRole('status').textContent).toBe('Saved');
    view.rerender(<UiToast message="用户写的中文标题" tone="success" />);
    expect(view.getByRole('status').textContent).toBe('用户写的中文标题');
    await act(() => i18n.changeLanguage(previous));
  });
  it('成功用 status、失败用 alert；状态只进图标颜色，表面走浮层令牌', () => {
    const { getByRole, rerender } = render(<UiToast message="已复制" tone="success" />);
    const ok = getByRole('status');
    expect(ok.textContent).toBe('已复制');
    expect(ok.className).toContain('bg-panel');
    expect(ok.querySelector('svg')?.getAttribute('class')).toContain('text-success-text');

    rerender(<UiToast message="复制失败" tone="error" />);
    const error = getByRole('alert');
    expect(error.className).not.toMatch(/bg-danger/);
    expect(error.querySelector('svg')?.getAttribute('class')).toContain('text-danger-text');
  });

  it('画布内用玻璃 + 容器定位；淡出时不拦截指针', () => {
    const { getByRole } = render(<UiToast message="无法连接" tone="error" surface="glass" placement="container" visible={false} />);
    const panel = getByRole('alert');
    expect(panel.className).toContain('ui-glass');
    const wrapper = panel.parentElement as HTMLElement;
    expect(wrapper.className).toContain('absolute');
    expect(wrapper.className).toContain('pointer-events-none');
    expect(wrapper.className).toContain('opacity-0');
  });
  it('到期提醒动作可用键盘或点击，淡出后不再可操作', () => {
    const onClick = vi.fn();
    const action = { label: '打开连接设置', onClick };
    const { getByRole, rerender } = render(<UiToast message="连接即将到期" tone="warning" action={action} />);
    fireEvent.click(getByRole('button', { name: action.label }));
    expect(onClick).toHaveBeenCalledOnce();
    rerender(<UiToast message="连接即将到期" tone="warning" action={action} visible={false} />);
    fireEvent.click(getByRole('button', { name: action.label }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('通知状态（全局与生成页共用时长）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('全局通知：停留后淡出再卸载', () => {
    const { result } = renderHook(() => useNotification(), { wrapper: NotificationProvider });
    act(() => result.current.showNotification('已保存'));
    expect(document.querySelector('[role="status"]')?.textContent).toBe('已保存');
    act(() => vi.advanceTimersByTime(UI_TOAST_DISPLAY_MS));
    expect(result.current.notificationVisible).toBe(false);
    act(() => vi.advanceTimersByTime(UI_TOAST_EXIT_MS));
    expect(document.querySelector('[role="status"]')).toBeNull();
  });

  it('生成页通知：淡出途中再次通知，新通知不会被上一条的卸载定时器清掉', () => {
    const { result } = renderHook(() => useToast());
    act(() => result.current.show('第一条'));
    act(() => vi.advanceTimersByTime(UI_TOAST_DISPLAY_MS + 10));
    expect(result.current.visible).toBe(false);
    act(() => result.current.show('第二条', 'error'));
    act(() => vi.advanceTimersByTime(UI_TOAST_EXIT_MS + 10));
    expect(result.current.notification).toEqual({ message: '第二条', type: 'error' });
    expect(result.current.visible).toBe(true);
  });
});
