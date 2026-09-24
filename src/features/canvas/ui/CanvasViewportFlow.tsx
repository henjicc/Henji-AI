import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { ReactFlow, useStoreApi, type ReactFlowProps, type Viewport } from '@xyflow/react';
import type { CanvasEdge, CanvasNode } from '../domain/canvasNodes';
import { DEFAULT_VIEWPORT } from '../canvasUtils';
import { createCanvasNodeLayout } from '../hooks/canvasNodeLayout';

type Props = Omit<ReactFlowProps<CanvasNode, CanvasEdge>, 'viewport' | 'onViewportChange'>;

/** Canvas 专用视口调度；节点、边及持久化仍由原有入口负责。 */
export function CanvasViewportFlow(props: Props): JSX.Element {
  const { onMove: notifyMove, onMoveEnd: notifyMoveEnd } = props;
  const { getState, subscribe } = useStoreApi();
  useEffect(() => createCanvasNodeLayout({ getState, subscribe }), [getState, subscribe]);
  const [viewport, setViewport] = useState(props.defaultViewport ?? DEFAULT_VIEWPORT);
  const pending = useRef<Viewport | null>(null);
  const frame = useRef<number | null>(null);

  const flushViewport = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    const next = pending.current;
    pending.current = null;
    if (!next) return;
    // 必须在本次回调内同步受控值，避免下一次原生事件已经改变 D3 视口后，
    // ReactFlow 的同步 effect 又用上一帧的位置覆盖它。
    flushSync(() => setViewport(previous => previous.x === next.x && previous.y === next.y && previous.zoom === next.zoom ? previous : next));
  }, []);

  const scheduleViewport = useCallback((next: Viewport) => {
    pending.current = next;
    frame.current ??= requestAnimationFrame(flushViewport);
  }, [flushViewport]);

  const onMove = useCallback<NonNullable<Props['onMove']>>((event, next) => {
    // 工程恢复、适应视图和小地图不是高频原生输入；在当前调用结束后提交，
    // 同时避开 ReactFlow 初始化 effect 中调用 flushSync。
    if (!event && pending.current) queueMicrotask(flushViewport);
    notifyMove?.(event, next);
  }, [flushViewport, notifyMove]);

  const onMoveEnd = useCallback<NonNullable<Props['onMoveEnd']>>((event, next) => {
    flushViewport();
    notifyMoveEnd?.(event, next);
  }, [flushViewport, notifyMoveEnd]);

  useEffect(() => {
    // 捕获阶段先于节点坐标换算、全局快捷键和画布外的切页按钮。
    const inputs = ['pointerdown', 'keydown', 'drop'] as const;
    inputs.forEach(type => window.addEventListener(type, flushViewport, true));
    window.addEventListener('blur', flushViewport);
    window.addEventListener('pagehide', flushViewport);
    return () => {
      inputs.forEach(type => window.removeEventListener(type, flushViewport, true));
      window.removeEventListener('blur', flushViewport);
      window.removeEventListener('pagehide', flushViewport);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      pending.current = null;
    };
  }, [flushViewport]);

  return <ReactFlow<CanvasNode, CanvasEdge>
    {...props}
    viewport={viewport}
    onViewportChange={scheduleViewport}
    onMove={onMove}
    onMoveEnd={onMoveEnd}
  />;
}
