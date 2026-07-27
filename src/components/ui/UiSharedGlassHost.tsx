import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type HTMLAttributes,
} from 'react';

const GLASS_TARGET_SELECTOR =
  '.ui-glass:not(.ui-shared-glass-layer):not([data-ui-shared-glass="exclude"])';
const TRANSITION_SAMPLE_MS = 320;

interface UiSharedGlassHostProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * 可见玻璃达到该数量后才合并。少量玻璃保留各自的小合成层，
   * 避免为了一个按钮创建覆盖整个宿主的共享 backdrop surface。
   */
  minTargets?: number;
}

interface GlassMaskRect {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  opacity: number;
}

function roundMaskValue(value: number): number {
  return Math.round(value * 10) / 10;
}

function readCumulativeOpacity(element: HTMLElement, host: HTMLElement): number {
  let opacity = 1;
  let current: HTMLElement | null = element;

  while (current && current !== host) {
    const parsed = Number.parseFloat(window.getComputedStyle(current).opacity);
    if (Number.isFinite(parsed)) opacity *= parsed;
    if (opacity <= 0.01) return 0;
    current = current.parentElement;
  }

  return Math.min(1, Math.max(0, opacity));
}

function readMaskRadius(element: HTMLElement, width: number, height: number): number {
  const style = window.getComputedStyle(element);
  const radii = [
    style.borderTopLeftRadius,
    style.borderTopRightRadius,
    style.borderBottomRightRadius,
    style.borderBottomLeftRadius,
  ].map((value) => Number.parseFloat(value) || 0);

  return Math.min(Math.max(...radii), width / 2, height / 2);
}

function createMaskImage(width: number, height: number, rects: GlassMaskRect[]): string {
  const shapes = rects
    .map(
      ({ x, y, width: rectWidth, height: rectHeight, radius, opacity }) =>
        `<rect x="${roundMaskValue(x)}" y="${roundMaskValue(y)}" width="${roundMaskValue(rectWidth)}" height="${roundMaskValue(rectHeight)}" rx="${roundMaskValue(radius)}" fill="white" fill-opacity="${roundMaskValue(opacity)}"/>`,
    )
    .join('');
  const svg =
    // icon-token-allow：这是由目标元素几何实时生成的 alpha 蒙版，不是图标。
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${roundMaskValue(width)} ${roundMaskValue(height)}">` +
    shapes +
    '</svg>';

  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/**
 * 把同一媒体/画布区域里的多块 `.ui-glass` 合成一次 backdrop-filter。
 *
 * 子元素仍使用原有 UiButton / UiIconButton / UiPanel，不需要另一套视觉组件；
 * 宿主只把它们的圆角矩形收集成一张 alpha mask。目标低于阈值时自动回退到
 * 原来的逐元素玻璃，关闭“毛玻璃效果”设置时也继续沿用全局不透明材质。
 */
export const UiSharedGlassHost = forwardRef<HTMLDivElement, UiSharedGlassHostProps>(
  ({ children, className = '', minTargets = 3, ...props }, forwardedRef) => {
    const hostRef = useRef<HTMLDivElement>(null);
    const layerRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(forwardedRef, () => hostRef.current as HTMLDivElement, []);

    useLayoutEffect(() => {
      const host = hostRef.current;
      const layer = layerRef.current;
      if (!host || !layer) return;

      let measureFrame = 0;
      let animationFrame = 0;
      let animationDeadline = 0;
      const observedTargets = new Set<HTMLElement>();
      const intersectingTargets = new Set<HTMLElement>();

      const resizeObserver = new ResizeObserver(() => scheduleMeasure());
      const intersectionObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            const target = entry.target as HTMLElement;
            if (entry.isIntersecting) intersectingTargets.add(target);
            else intersectingTargets.delete(target);
          });
          scheduleMeasure();
        },
        { root: host },
      );

      const syncTargets = (): void => {
        const nextTargets = new Set(
          host.querySelectorAll<HTMLElement>(GLASS_TARGET_SELECTOR),
        );

        observedTargets.forEach((target) => {
          if (nextTargets.has(target)) return;
          resizeObserver.unobserve(target);
          intersectionObserver.unobserve(target);
          intersectingTargets.delete(target);
          observedTargets.delete(target);
        });

        nextTargets.forEach((target) => {
          if (observedTargets.has(target)) return;
          observedTargets.add(target);
          resizeObserver.observe(target);
          intersectionObserver.observe(target);
        });
      };

      const applyInactiveState = (): void => {
        if (host.dataset.uiSharedGlassActive !== 'false') {
          host.dataset.uiSharedGlassActive = 'false';
        }
        layer.style.removeProperty('top');
        layer.style.removeProperty('left');
        layer.style.removeProperty('width');
        layer.style.removeProperty('height');
        layer.style.removeProperty('mask-image');
        layer.style.removeProperty('-webkit-mask-image');
      };

      const measure = (): void => {
        measureFrame = 0;
        const hostRect = host.getBoundingClientRect();
        const left = Math.max(0, hostRect.left);
        const top = Math.max(0, hostRect.top);
        const right = Math.min(window.innerWidth, hostRect.right);
        const bottom = Math.min(window.innerHeight, hostRect.bottom);
        const width = Math.max(0, right - left);
        const height = Math.max(0, bottom - top);

        if (width < 1 || height < 1) {
          applyInactiveState();
          return;
        }

        const rects: GlassMaskRect[] = [];
        intersectingTargets.forEach((target) => {
          const style = window.getComputedStyle(target);
          if (style.display === 'none' || style.visibility === 'hidden') return;

          const targetRect = target.getBoundingClientRect();
          if (
            targetRect.width < 1 ||
            targetRect.height < 1 ||
            targetRect.right <= left ||
            targetRect.left >= right ||
            targetRect.bottom <= top ||
            targetRect.top >= bottom
          ) {
            return;
          }

          const opacity = readCumulativeOpacity(target, host);
          if (opacity <= 0.01) return;

          rects.push({
            x: targetRect.left - left,
            y: targetRect.top - top,
            width: targetRect.width,
            height: targetRect.height,
            radius: readMaskRadius(target, targetRect.width, targetRect.height),
            opacity,
          });
        });

        if (rects.length < minTargets) {
          applyInactiveState();
          return;
        }

        const maskImage = createMaskImage(width, height, rects);
        layer.style.top = `${roundMaskValue(top)}px`;
        layer.style.left = `${roundMaskValue(left)}px`;
        layer.style.width = `${roundMaskValue(width)}px`;
        layer.style.height = `${roundMaskValue(height)}px`;
        layer.style.maskImage = maskImage;
        layer.style.setProperty('-webkit-mask-image', maskImage);
        if (host.dataset.uiSharedGlassActive !== 'true') {
          host.dataset.uiSharedGlassActive = 'true';
        }
      };

      function scheduleMeasure(): void {
        if (measureFrame !== 0) return;
        measureFrame = window.requestAnimationFrame(measure);
      }

      const sampleTransition = (): void => {
        animationFrame = 0;
        scheduleMeasure();
        if (performance.now() >= animationDeadline) return;
        animationFrame = window.requestAnimationFrame(sampleTransition);
      };

      const handleVisualTransition = (event: Event): void => {
        if (!(event.target instanceof HTMLElement) || event.target === layer) return;
        const affectsGlass =
          event.target.matches(GLASS_TARGET_SELECTOR) ||
          event.target.querySelector(GLASS_TARGET_SELECTOR) !== null;
        if (!affectsGlass) return;
        animationDeadline = Math.max(animationDeadline, performance.now() + TRANSITION_SAMPLE_MS);
        if (animationFrame === 0) {
          animationFrame = window.requestAnimationFrame(sampleTransition);
        }
      };

      const nodeContainsGlass = (node: Node): boolean => {
        if (!(node instanceof HTMLElement)) return false;
        return node.matches(GLASS_TARGET_SELECTOR) || node.querySelector(GLASS_TARGET_SELECTOR) !== null;
      };

      const mutationObserver = new MutationObserver((records) => {
        const affectsGlass = records.some((record) => {
          if (record.type === 'childList') {
            return (
              Array.from(record.addedNodes).some(nodeContainsGlass) ||
              Array.from(record.removedNodes).some(nodeContainsGlass)
            );
          }
          if (!(record.target instanceof HTMLElement) || record.target === layer) return false;
          return (
            observedTargets.has(record.target) ||
            record.target.matches(GLASS_TARGET_SELECTOR) ||
            record.target.querySelector(GLASS_TARGET_SELECTOR) !== null
          );
        });
        if (!affectsGlass) return;
        syncTargets();
        scheduleMeasure();
      });

      resizeObserver.observe(host);
      mutationObserver.observe(host, {
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'],
        childList: true,
        subtree: true,
      });
      window.addEventListener('resize', scheduleMeasure);
      window.addEventListener('scroll', scheduleMeasure, true);
      host.addEventListener('transitionrun', handleVisualTransition, true);
      host.addEventListener('animationstart', handleVisualTransition, true);
      syncTargets();
      scheduleMeasure();

      return () => {
        if (measureFrame !== 0) window.cancelAnimationFrame(measureFrame);
        if (animationFrame !== 0) window.cancelAnimationFrame(animationFrame);
        resizeObserver.disconnect();
        intersectionObserver.disconnect();
        mutationObserver.disconnect();
        window.removeEventListener('resize', scheduleMeasure);
        window.removeEventListener('scroll', scheduleMeasure, true);
        host.removeEventListener('transitionrun', handleVisualTransition, true);
        host.removeEventListener('animationstart', handleVisualTransition, true);
      };
    }, [minTargets]);

    return (
      <div
        ref={hostRef}
        className={`relative isolate ${className}`}
        data-ui-shared-glass-active="false"
        {...props}
      >
        <div
          ref={layerRef}
          aria-hidden="true"
          className="ui-glass ui-shared-glass-layer pointer-events-none fixed"
        />
        {children}
      </div>
    );
  },
);

UiSharedGlassHost.displayName = 'UiSharedGlassHost';
