import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactFlowProps } from '@xyflow/react';
import type { CanvasEdge, CanvasNode } from '../domain/canvasNodes';

type FlowProps = ReactFlowProps<CanvasNode, CanvasEdge>;
const CALLBACK_KEYS = [
  'onNodesChange', 'onEdgesChange', 'onConnect', 'onConnectStart', 'onConnectEnd',
  'onNodeDragStart', 'onNodeDragStop', 'onSelectionDragStart', 'onSelectionDragStop',
  'onMoveStart', 'onMove', 'onMoveEnd', 'onEdgeDoubleClick', 'onNodeContextMenu',
  'onPaneClick', 'onPaneContextMenu',
] as const satisfies readonly (keyof FlowProps)[];
type Callbacks = Pick<FlowProps, typeof CALLBACK_KEYS[number]>;

/** ReactFlow 逐项同步回调；稳定身份避免每次编辑都反复唤醒整图订阅。 */
export function useCanvasFlowCallbacks(props: Callbacks): Callbacks {
  const latest = useRef(props);
  useLayoutEffect(() => { latest.current = props; });
  const [delegates] = useState(() => Object.fromEntries(CALLBACK_KEYS.map(key => [key, (...args: unknown[]) => {
    // 每个代理只转发同名回调的原始参数和返回值，类型映射在入口保留。
    const callback = latest.current[key] as ((...values: unknown[]) => unknown) | undefined;
    return callback?.(...args);
  }])) as Callbacks);
  return Object.fromEntries(CALLBACK_KEYS.map(key => [key, props[key] ? delegates[key] : undefined])) as Callbacks;
}
