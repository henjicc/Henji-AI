import { useCallback, useEffect, useRef, type RefObject } from 'react';

const HIGH_GLASS_DENSITY_THRESHOLD = 64;
const GLASS_SELECTOR = '.react-flow__viewport .ui-glass';

interface CanvasGlassPerformance {
  prepareGlassGesture: () => void;
  clearGlassGesture: () => void;
}

function findGlassElements(root: Element): HTMLElement[] {
  const elements: HTMLElement[] = [];
  if (root instanceof HTMLElement && root.matches(GLASS_SELECTOR)) {
    elements.push(root);
  }
  elements.push(...root.querySelectorAll<HTMLElement>(GLASS_SELECTOR));
  return elements;
}

/**
 * 画布手势期间的玻璃预算。
 *
 * IntersectionObserver 在手势前异步维护可见玻璃计数；手势开始时只读取缓存并切换
 * class，避免 getComputedStyle/getBoundingClientRect 把样式计算和布局同步塞进首帧。
 */
export function useCanvasGlassPerformance(
  wrapperRef: RefObject<HTMLDivElement | null>,
): CanvasGlassPerformance {
  const hasHighVisibleGlassDensityRef = useRef(false);

  useEffect(() => {
    const container = wrapperRef.current;
    if (!container) return undefined;

    const observedElements = new Set<HTMLElement>();
    const visibleElements = new Set<HTMLElement>();
    const updateDensity = (): void => {
      hasHighVisibleGlassDensityRef.current = (
        visibleElements.size >= HIGH_GLASS_DENSITY_THRESHOLD
      );
    };

    if (typeof IntersectionObserver === 'undefined') {
      const updateFallbackDensity = (): void => {
        hasHighVisibleGlassDensityRef.current = (
          container.querySelectorAll(GLASS_SELECTOR).length >= HIGH_GLASS_DENSITY_THRESHOLD
        );
      };
      updateFallbackDensity();
      const fallbackObserver = new MutationObserver(updateFallbackDensity);
      fallbackObserver.observe(container, { childList: true, subtree: true });
      return () => fallbackObserver.disconnect();
    }

    const intersectionObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const element = entry.target as HTMLElement;
        if (entry.isIntersecting) {
          visibleElements.add(element);
        } else {
          visibleElements.delete(element);
        }
      }
      updateDensity();
    }, { root: container });

    const observeElement = (element: HTMLElement): void => {
      if (observedElements.has(element)) return;
      observedElements.add(element);
      intersectionObserver.observe(element);
    };

    const unobserveRemovedTree = (removedRoot: Node): void => {
      for (const element of observedElements) {
        if (element === removedRoot || removedRoot.contains(element)) {
          intersectionObserver.unobserve(element);
          observedElements.delete(element);
          visibleElements.delete(element);
        }
      }
    };

    findGlassElements(container).forEach(observeElement);

    const mutationObserver = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => {
          if (node instanceof Element) findGlassElements(node).forEach(observeElement);
        });
        record.removedNodes.forEach(unobserveRemovedTree);
      }
      updateDensity();
    });
    mutationObserver.observe(container, { childList: true, subtree: true });

    return () => {
      mutationObserver.disconnect();
      intersectionObserver.disconnect();
      observedElements.clear();
      visibleElements.clear();
      hasHighVisibleGlassDensityRef.current = false;
    };
  }, [wrapperRef]);

  const prepareGlassGesture = useCallback((): void => {
    const container = wrapperRef.current;
    if (!container) return;
    container.classList.toggle(
      'canvas-glass-density-high',
      hasHighVisibleGlassDensityRef.current,
    );
  }, [wrapperRef]);

  const clearGlassGesture = useCallback((): void => {
    wrapperRef.current?.classList.remove('canvas-glass-density-high');
  }, [wrapperRef]);

  return { prepareGlassGesture, clearGlassGesture };
}
