/** @vitest-environment jsdom */

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useCanvasGlassPerformance } from './useCanvasGlassPerformance';

describe('useCanvasGlassPerformance', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('异步缓存可见玻璃密度，手势开始时不读取样式或布局', () => {
    let intersectionCallback: IntersectionObserverCallback | null = null;
    const observedElements: Element[] = [];

    class MockIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) {
        intersectionCallback = callback;
      }

      observe(element: Element): void {
        observedElements.push(element);
      }

      unobserve(): void {}

      disconnect(): void {}
    }

    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    const container = document.createElement('div');
    const viewport = document.createElement('div');
    viewport.className = 'react-flow__viewport';
    for (let index = 0; index < 64; index += 1) {
      const glass = document.createElement('div');
      glass.className = 'ui-glass';
      viewport.append(glass);
    }
    container.append(viewport);
    document.body.append(container);

    const { result, unmount } = renderHook(() => useCanvasGlassPerformance({ current: container }));
    expect(observedElements).toHaveLength(64);

    act(() => {
      intersectionCallback?.(
        observedElements.map((target) => ({ target, isIntersecting: true } as IntersectionObserverEntry)),
        {} as IntersectionObserver,
      );
    });

    const computedStyleSpy = vi.spyOn(window, 'getComputedStyle');
    const layoutSpy = vi.spyOn(container, 'getBoundingClientRect');
    act(() => result.current.prepareGlassGesture());

    expect(container.classList.contains('canvas-glass-density-high')).toBe(true);
    expect(computedStyleSpy).not.toHaveBeenCalled();
    expect(layoutSpy).not.toHaveBeenCalled();

    act(() => result.current.clearGlassGesture());
    expect(container.classList.contains('canvas-glass-density-high')).toBe(false);
    unmount();
  });
});
