import { useCallback, useEffect, useRef, useState, type AnimationEvent, type RefObject, type TransitionEvent } from 'react';
import { UI_DIALOG_TRANSITION_MS, UI_TOAST_DISPLAY_MS, UI_TOAST_EXIT_MS } from './motion';

interface DialogTransitionOptions {
  /** 退出完成回调；计时器与结束事件先到者通知一次，重开会取消旧通知。 */
  onExited?: () => void;
  /** 原生结束事件的动画根节点（跨文档浮层与 React 事件均可用）。 */
  exitRef?: RefObject<HTMLElement>;
  /** 替换内容但仍打开时，重新播放进入过渡。 */
  enterKey?: unknown;
}

interface DialogTransitionState {
  shouldRender: boolean;
  isVisible: boolean;
  /** 已关闭，只保留退出过渡；调用方写 inert / aria-hidden。 */
  closing: boolean;
  onTransitionEnd: (event: TransitionEvent<HTMLElement>) => void;
  onAnimationEnd: (event: AnimationEvent<HTMLElement>) => void;
}

export function useDialogTransition(
  isOpen: boolean,
  durationMs: number = UI_DIALOG_TRANSITION_MS,
  /** false 只跳过首次进入，用于接替已显示的占位。 */
  appear = true,
  { onExited, exitRef, enterKey }: DialogTransitionOptions = {},
): DialogTransitionState {
  const [motionPreference] = useState(() => (
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)') : null
  ));
  const [reducedMotion, setReducedMotion] = useState(motionPreference?.matches ?? false);
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isVisible, setIsVisible] = useState((reducedMotion || !appear) && isOpen);
  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;
  const onExitedRef = useRef(onExited);
  onExitedRef.current = onExited;
  const wasOpenRef = useRef(isOpen);
  const exitPendingRef = useRef(false);
  const skipEnterRef = useRef(!appear && isOpen);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finishExit = useCallback((): void => {
    if (isOpenRef.current || !exitPendingRef.current) return;
    exitPendingRef.current = false;
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
    setShouldRender(false);
    onExitedRef.current?.();
  }, []);

  useEffect(() => {
    if (!motionPreference) return;
    const update = (): void => setReducedMotion(motionPreference.matches);
    update();
    motionPreference.addEventListener('change', update);
    return () => motionPreference.removeEventListener('change', update);
  }, [motionPreference]);

  useEffect(() => {
    let frameId1 = 0;
    let frameId2 = 0;
    if (isOpen) {
      wasOpenRef.current = true;
      exitPendingRef.current = false;
      setShouldRender(true);
      if (reducedMotion || durationMs === 0 || skipEnterRef.current) {
        skipEnterRef.current = false;
        setIsVisible(true);
      } else {
        setIsVisible(false);
        frameId1 = requestAnimationFrame(() => {
          frameId2 = requestAnimationFrame(() => setIsVisible(true));
        });
      }
    } else {
      setIsVisible(false);
      if (wasOpenRef.current) {
        wasOpenRef.current = false;
        exitPendingRef.current = true;
      }
      if (reducedMotion || durationMs === 0) finishExit();
      else if (exitPendingRef.current) timerRef.current = setTimeout(finishExit, durationMs);
    }
    return () => {
      cancelAnimationFrame(frameId1);
      cancelAnimationFrame(frameId2);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [durationMs, enterKey, finishExit, isOpen, reducedMotion]);

  useEffect(() => {
    const element = exitRef?.current;
    if (isOpen || !shouldRender || !element) return;
    const onEnd = (event: Event): void => { if (event.target === element) finishExit(); };
    element.addEventListener('transitionend', onEnd);
    element.addEventListener('animationend', onEnd);
    return () => {
      element.removeEventListener('transitionend', onEnd);
      element.removeEventListener('animationend', onEnd);
    };
  }, [exitRef, finishExit, isOpen, shouldRender]);

  const onEnd = useCallback((event: TransitionEvent<HTMLElement> | AnimationEvent<HTMLElement>): void => {
    if (event.target === event.currentTarget) finishExit();
  }, [finishExit]);
  return { shouldRender, isVisible, closing: shouldRender && !isOpen, onTransitionEnd: onEnd, onAnimationEnd: onEnd };
}

/** 通知只管理内容与停留，进入/退出统一委托公共生命周期。 */
export function useTimedToast<T>(displayMs = UI_TOAST_DISPLAY_MS, exitMs = UI_TOAST_EXIT_MS) {
  const [entry, setEntry] = useState<{ notification: T; version: number } | null>(null);
  const [open, setOpen] = useState(false);
  const versionRef = useRef(0);
  const transition = useDialogTransition(open, entry ? exitMs : 0, true, {
    enterKey: entry?.version,
    onExited: () => setEntry(null),
  });
  useEffect(() => {
    if (!entry) return;
    const timer = setTimeout(() => setOpen(false), displayMs);
    return () => clearTimeout(timer);
  }, [displayMs, entry]);
  const show = useCallback((notification: T): void => {
    setEntry({ notification, version: ++versionRef.current });
    setOpen(true);
  }, []);
  const clear = useCallback((): void => { setOpen(false); setEntry(null); }, []);
  return { notification: entry?.notification ?? null, visible: transition.isVisible, show, clear };
}
