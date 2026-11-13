import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { UI_DURATION } from '@/components/ui/motion';
import { useCanvasNodeBodyMode } from './useCanvasNodePresence';

interface CanvasNodeBodyProps {
  id: string;
  width: number | undefined;
  height: number | undefined;
  /** 正文需要挂载时才调用，未挂载的节点不为正文付任何渲染成本。 */
  render(size: { width: number | undefined; height: number | undefined }): ReactNode;
}

/**
 * 节点内容的闸门：指针所在、还没挂正文的节点只出一个与量得尺寸相同的空块（壳），让 ReactFlow 外框接住指针；
 * 其余被渲染的节点出真正的正文。哪些节点会被渲染由 presence/canvasNodePresence.ts 决定。
 */
export function CanvasNodeBody({ id, width, height, render }: CanvasNodeBodyProps): JSX.Element | null {
  const mode = useCanvasNodeBodyMode(id);
  const measured = typeof width === 'number' && width > 0 && typeof height === 'number' && height > 0;
  if (mode === 'off') return null;
  if (mode === 'shell') return measured ? <div style={{ width, height }} /> : null;
  // 没量过的节点外框尺寸是 0，不能当成显式尺寸交给正文
  return <CanvasNodeBodyEnter>{render(measured ? { width, height } : { width: undefined, height: undefined })}</CanvasNodeBodyEnter>;
}

/** 正文挂上后在远景画面之上淡入，不直接跳出来。 */
function CanvasNodeBodyEnter({ children }: { children: ReactNode }): JSX.Element {
  const marker = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const frame = marker.current?.parentElement;
    if (!frame || typeof frame.animate !== 'function') return;
    const animation = frame.animate([{ opacity: 0 }, { opacity: 1 }], { duration: UI_DURATION.fast, easing: 'ease-out' });
    return () => animation.cancel();
  }, []);
  return <><span ref={marker} hidden />{children}</>;
}
