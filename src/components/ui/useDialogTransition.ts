import { useCallback, useEffect, useRef, useState, type TransitionEvent } from 'react';
import { UI_DIALOG_TRANSITION_MS } from './motion';

interface DialogTransitionState {
  shouldRender: boolean;
  isVisible: boolean;
  /** 正在收起：已经关闭，只是还在播放退出过渡。此时不可点击、对读屏隐藏（调用方写 `inert` / `aria-hidden`）。 */
  closing: boolean;
  /**
   * 挂到做退出过渡的那个元素上：过渡结束即卸载，不只依赖计时器（任务 5.8，同 VE-06）。
   * 窗口在后台时计时器会被节流，只靠计时器时已关闭的浮层会长时间留在页面上。
   */
  onTransitionEnd: (event: TransitionEvent<HTMLElement>) => void;
}

export function useDialogTransition(
  isOpen: boolean,
  durationMs: number = UI_DIALOG_TRANSITION_MS
): DialogTransitionState {
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isVisible, setIsVisible] = useState(false);
  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;

  useEffect(() => {
    let frameId1 = 0;
    let frameId2 = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    if (isOpen) {
      setShouldRender(true);
      setIsVisible(false);
      frameId1 = requestAnimationFrame(() => {
        frameId2 = requestAnimationFrame(() => {
          setIsVisible(true);
        });
      });
      return () => {
        cancelAnimationFrame(frameId1);
        cancelAnimationFrame(frameId2);
        if (timer) {
          clearTimeout(timer);
        }
      };
    }

    setIsVisible(false);
    // 计时器与过渡结束先到先卸载
    timer = setTimeout(() => {
      setShouldRender(false);
    }, durationMs);

    return () => {
      if (timer) {
        clearTimeout(timer);
      }
      cancelAnimationFrame(frameId1);
      cancelAnimationFrame(frameId2);
    };
  }, [durationMs, isOpen]);

  const onTransitionEnd = useCallback((event: TransitionEvent<HTMLElement>): void => {
    if (event.target !== event.currentTarget || isOpenRef.current) return;
    setShouldRender(false);
  }, []);

  return { shouldRender, isVisible, closing: shouldRender && !isOpen, onTransitionEnd };
}
