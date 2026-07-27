import { useCallback, type RefObject } from 'react';

const HIGH_GLASS_DENSITY_THRESHOLD = 64;
const GLASS_SELECTOR = '.react-flow__viewport .ui-glass';

interface CanvasGlassPerformance {
  prepareGlassGesture: () => void;
  clearGlassGesture: () => void;
}

function intersectsViewport(element: HTMLElement, viewport: DOMRect): boolean {
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) <= 0.01) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.right > viewport.left &&
    rect.left < viewport.right &&
    rect.bottom > viewport.top &&
    rect.top < viewport.bottom
  );
}

function hasHighVisibleGlassDensity(container: HTMLDivElement): boolean {
  const viewport = container.getBoundingClientRect();
  const glassElements = container.querySelectorAll<HTMLElement>(GLASS_SELECTOR);
  let visibleCount = 0;

  for (const element of glassElements) {
    if (!intersectsViewport(element, viewport)) continue;
    visibleCount += 1;
    if (visibleCount >= HIGH_GLASS_DENSITY_THRESHOLD) return true;
  }

  return false;
}

/**
 * 画布手势期间的玻璃预算。
 *
 * 正常工程保持完整材质；只有可见玻璃达到实测掉帧拐点时，才在移动期间挂降级类。
 * 计数只发生在手势开始，不进入 React state，也不占用每帧 onMove。
 */
export function useCanvasGlassPerformance(
  wrapperRef: RefObject<HTMLDivElement | null>,
): CanvasGlassPerformance {
  const prepareGlassGesture = useCallback((): void => {
    const container = wrapperRef.current;
    if (!container) return;
    container.classList.toggle(
      'canvas-glass-density-high',
      hasHighVisibleGlassDensity(container),
    );
  }, [wrapperRef]);

  const clearGlassGesture = useCallback((): void => {
    wrapperRef.current?.classList.remove('canvas-glass-density-high');
  }, [wrapperRef]);

  return { prepareGlassGesture, clearGlassGesture };
}
