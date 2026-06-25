import { type ReactNode, useMemo } from 'react';
import { Handle, Position } from '@xyflow/react';

import type { CanvasNodeData, CanvasNodeType } from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { getSocketColor, type SocketType } from '@/features/canvas/domain/socketTypes';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { useCanvasStore } from '@/stores/canvasStore';

interface ValueSourceShellProps {
  id: string;
  nodeType: CanvasNodeType;
  data: CanvasNodeData;
  socketType: SocketType;
  selected?: boolean;
  icon?: ReactNode;
  children: ReactNode;
  /** 节点宽度（默认 180，模型选择器等更宽的内容可覆盖） */
  width?: number;
}

/**
 * 数值/源节点通用壳：标题 + 单一类型化输出端口 + 内联取值控件。
 * 行为差异（取值控件/类型）由各源节点组件传入，shell 只负责标题与端口。
 */
export function ValueSourceShell({
  id,
  nodeType,
  data,
  socketType,
  selected,
  icon,
  children,
  width = 180,
}: ValueSourceShellProps) {
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);

  const title = useMemo(
    () => resolveNodeDisplayName(nodeType, data),
    [data, nodeType]
  );
  const socketColor = getSocketColor(socketType);

  return (
    <div
      className={`
        group relative flex flex-col rounded-[var(--node-radius)] border bg-surface-dark/90 p-2 transition-colors duration-150
        ${selected
          ? 'border-accent shadow-[0_0_0_1px_rgba(59,130,246,0.32)]'
          : 'border-[rgba(255,255,255,0.22)] hover:border-[rgba(255,255,255,0.34)]'}
      `}
      style={{ width: `${width}px` }}
      onClick={() => setSelectedNode(id)}
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={icon}
        titleText={title}
        editable
        onTitleChange={(nextTitle) => updateNodeData(id, { displayName: nextTitle })}
      />

      <div className="nodrag nowheel">{children}</div>

      <Handle
        type="source"
        id="source"
        position={Position.Right}
        className="!h-2.5 !w-2.5 !border !border-surface-dark"
        style={{ background: socketColor, right: -6 }}
      />
    </div>
  );
}
