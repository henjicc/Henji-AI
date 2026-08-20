import type { CSSProperties, ReactNode } from 'react';
import { useCanvasExecutionStateStore } from '@/stores/canvasExecutionStateStore';

export interface CanvasNodePaintFrameOptions {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  disabled?: boolean;
}

interface CanvasNodePaintFrameProps extends CanvasNodePaintFrameOptions {
  children?: ReactNode;
  nodeId?: string;
}

interface CanvasNodePaintFrameStyle extends CSSProperties {
  '--canvas-node-paint-top'?: string;
  '--canvas-node-paint-right'?: string;
  '--canvas-node-paint-bottom'?: string;
  '--canvas-node-paint-left'?: string;
}

function toPixelValue(value: number | undefined): string | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? `${Math.max(0, value)}px` : undefined;
}

/**
 * 扩展节点的绘制裁剪框，但让外层 `.react-flow__node` 的布局尺寸保持不变。
 * 这里只处理浏览器绘制隔离，不承载节点业务、视觉样式或交互状态。
 */
export function CanvasNodePaintFrame({
  children,
  top,
  right,
  bottom,
  left,
  disabled = false,
  nodeId,
}: CanvasNodePaintFrameProps): JSX.Element {
  const isExecuting = useCanvasExecutionStateStore(
    (state) => Boolean(nodeId && state.activeNodes[nodeId]),
  );

  if (disabled) {
    return <>{children}</>;
  }

  const style: CanvasNodePaintFrameStyle = {
    '--canvas-node-paint-top': toPixelValue(top),
    '--canvas-node-paint-right': toPixelValue(right),
    '--canvas-node-paint-bottom': toPixelValue(bottom),
    '--canvas-node-paint-left': toPixelValue(left),
  };

  return (
    <div
      className={`canvas-node-paint-frame${isExecuting ? ' canvas-node-paint-frame--executing' : ''}`}
      style={style}
      data-node-executing={isExecuting ? 'true' : undefined}
      aria-busy={isExecuting || undefined}
    >
      {children}
    </div>
  );
}
