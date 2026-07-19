import { useEffect, useRef, type RefObject } from 'react';

/**
 * 在元素上绑定非 passive 的 wheel 监听。
 * React 合成 wheel 事件是 passive 的,无法 preventDefault 阻止宿主容器滚动,
 * 滑块/画布上的滚轮微调必须走原生监听。
 */
export function useNonPassiveWheel(
  elementRef: RefObject<HTMLElement>,
  handler: ((event: WheelEvent) => void) | null,
  /** 元素可能延迟挂载(如图片加载后),传入变化的依赖以重绑 */
  rebindKey?: unknown
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const element = elementRef.current;
    if (!element) {
      return;
    }
    const onWheel = (event: WheelEvent): void => {
      handlerRef.current?.(event);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [elementRef, rebindKey]);
}
