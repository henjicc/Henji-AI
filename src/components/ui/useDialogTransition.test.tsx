/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnimationEvent, TransitionEvent } from 'react';
import { useDialogTransition } from './useDialogTransition';
import { UI_DURATION } from './motion';

let media: MediaQueryList;
let listeners: Set<(event: MediaQueryListEvent) => void>;

beforeEach(() => {
  vi.useFakeTimers();
  listeners = new Set();
  media = {
    matches: false,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: vi.fn((_type, listener) => { listeners.add(listener as (event: MediaQueryListEvent) => void); }),
    removeEventListener: vi.fn((_type, listener) => { listeners.delete(listener as (event: MediaQueryListEvent) => void); }),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  };
  vi.stubGlobal('matchMedia', vi.fn(() => media));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function reduceMotion(): void {
  Object.defineProperty(media, 'matches', { value: true });
  act(() => listeners.forEach(listener => listener({ matches: true } as MediaQueryListEvent)));
}

describe('公共进出场生命周期', () => {
  it('两帧进场，退出保留到同档计时，重开取消旧卸载', () => {
    const { result, rerender } = renderHook(({ open }) => useDialogTransition(open), { initialProps: { open: true } });
    expect(result.current.isVisible).toBe(false);
    act(() => vi.advanceTimersByTime(16));
    expect(result.current.isVisible).toBe(false);
    act(() => vi.advanceTimersByTime(16));
    expect(result.current.isVisible).toBe(true);
    rerender({ open: false });
    expect(result.current.closing).toBe(true);
    act(() => vi.advanceTimersByTime(UI_DURATION.base - 1));
    expect(result.current.shouldRender).toBe(true);
    rerender({ open: true });
    act(() => vi.advanceTimersByTime(UI_DURATION.base));
    expect(result.current.shouldRender).toBe(true);
    expect(result.current.isVisible).toBe(true);
    rerender({ open: false });
    act(() => vi.advanceTimersByTime(UI_DURATION.base));
    expect(result.current.shouldRender).toBe(false);
  });

  it('appear=false 首次直接可见，随后重开仍正常进场', () => {
    const { result, rerender } = renderHook(({ open }) => useDialogTransition(open, UI_DURATION.viewer, false), { initialProps: { open: true } });
    expect(result.current.isVisible).toBe(true);
    rerender({ open: false });
    rerender({ open: true });
    expect(result.current.isVisible).toBe(false);
    act(() => vi.advanceTimersByTime(32));
    expect(result.current.isVisible).toBe(true);
  });

  it.each(['onTransitionEnd', 'onAnimationEnd'] as const)('%s 只响应本元素退出，忽略子元素和已重新打开的结束信号', handler => {
    const { result, rerender } = renderHook(({ open }) => useDialogTransition(open), { initialProps: { open: true } });
    const target = document.createElement('div');
    const child = document.createElement('span');
    const event = { target, currentTarget: target } as unknown as TransitionEvent<HTMLElement> & AnimationEvent<HTMLElement>;
    rerender({ open: false });
    act(() => result.current[handler]({ ...event, target: child }));
    expect(result.current.shouldRender).toBe(true);
    act(() => result.current[handler](event));
    expect(result.current.shouldRender).toBe(false);
    rerender({ open: true });
    act(() => result.current[handler](event));
    expect(result.current.shouldRender).toBe(true);
  });

  it('系统减少动效首帧直接显示，关闭立即卸载', () => {
    Object.defineProperty(media, 'matches', { value: true });
    const { result, rerender } = renderHook(({ open }) => useDialogTransition(open, UI_DURATION.viewer), { initialProps: { open: true } });
    expect(result.current.isVisible).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    rerender({ open: false });
    expect(result.current.shouldRender).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('运行中切到减少动效取消退出等待，并清理订阅', () => {
    const { result, rerender, unmount } = renderHook(({ open }) => useDialogTransition(open), { initialProps: { open: true } });
    rerender({ open: false });
    reduceMotion();
    expect(result.current.shouldRender).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    unmount();
    expect(listeners.size).toBe(0);
  });

  it('尚未进场即关闭或卸载，不残留 rAF 或计时器', () => {
    const { result, rerender, unmount } = renderHook(({ open }) => useDialogTransition(open), { initialProps: { open: true } });
    rerender({ open: false });
    act(() => vi.advanceTimersByTime(32));
    expect(result.current.isVisible).toBe(false);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
