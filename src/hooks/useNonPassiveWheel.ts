import { useEffect, useRef, type RefObject } from 'react';

/**
 * 在元素上绑定非 passive 的 wheel 监听（全应用唯一入口）。
 * React 合成 wheel 事件是 passive 的：在 onWheel 里 preventDefault 会被浏览器忽略并在控制台报警，
 * 也拦不住宿主容器滚动。滚轮要调值、缩放或横向滚动并阻止默认滚动时，一律走这里。
 * 处理函数每次渲染更新但监听只绑一次；元素延迟挂载（条件渲染、图片加载后）时传入变化的 rebindKey 重绑。
 */
export function useNonPassiveWheel<T extends Element>(
  elementRef: RefObject<T>,
  handler: ((event: WheelEvent) => void) | null,
  rebindKey?: unknown
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const element = elementRef.current;
    if (!element) {
      return;
    }
    const onWheel = (event: Event): void => {
      handlerRef.current?.(event as WheelEvent);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [elementRef, rebindKey]);
}
