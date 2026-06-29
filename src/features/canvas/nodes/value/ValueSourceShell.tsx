import { type ReactNode, useMemo } from 'react';
import { Handle, Position } from '@xyflow/react';

import type { CanvasNodeData, CanvasNodeType } from '@/features/canvas/domain/canvasNodes';
import { getMainPortConnectionFlags } from '@/features/canvas/domain/connectionIndex';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { getSocketColor, type SocketType } from '@/features/canvas/domain/socketTypes';
import {
  NODE_HEADER_FLOATING_POSITION_CLASS,
  NODE_HEADER_ICON_TITLE_ADJUST,
  NodeHeader,
} from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import {
  NODE_PORT_NODE_CLASS,
  NODE_PORT_VISIBLE_CLASS,
} from '@/features/canvas/ui/nodeControlStyles';
import { useCanvasStore } from '@/stores/canvasStore';

interface ValueSourceShellProps {
  id: string;
  nodeType: CanvasNodeType;
  data: CanvasNodeData;
  socketType: SocketType;
  selected?: boolean;
  icon?: ReactNode;
  /** 标题栏右侧插槽（如模型选择器节点的展开/折叠切换按钮），不传时维持原有无插槽外观 */
  headerRightSlot?: ReactNode;
  children: ReactNode;
  /** 节点宽度（默认 180，模型选择器等更宽的内容可覆盖） */
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  resizable?: boolean;
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
  headerRightSlot,
  children,
  width = 180,
  height,
  minWidth = 160,
  minHeight = 56,
  maxWidth = 720,
  maxHeight = 520,
  resizable = true,
}: ValueSourceShellProps) {
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const hasSourceConnections = useCanvasStore(
    (state) => getMainPortConnectionFlags(state.edges).get(id)?.hasMainSource ?? false
  );

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
      style={{
        width: `${Math.max(minWidth, Math.round(width))}px`,
        minWidth: `${minWidth}px`,
        minHeight: `${minHeight}px`,
        maxWidth: `${maxWidth}px`,
        maxHeight: `${maxHeight}px`,
        ...(typeof height === 'number' && Number.isFinite(height)
          ? { height: `${Math.max(minHeight, Math.round(height))}px` }
          : {}),
      }}
      onClick={() => setSelectedNode(id)}
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={icon}
        titleText={title}
        editable
        onTitleChange={(nextTitle) => updateNodeData(id, { displayName: nextTitle })}
        rightSlot={headerRightSlot}
        rightSlotAdjust={NODE_HEADER_ICON_TITLE_ADJUST}
      />

      <div className="nodrag nowheel flex min-h-0 flex-1 flex-col justify-center">{children}</div>

      <Handle
        type="source"
        id="source"
        position={Position.Right}
        className={`${NODE_PORT_NODE_CLASS} ${hasSourceConnections ? NODE_PORT_VISIBLE_CLASS : ''}`}
        style={{ background: socketColor, right: 0, top: '50%', transform: 'translate(50%, -50%)' }}
      />
      {resizable && (
        <NodeResizeHandle
          minWidth={minWidth}
          minHeight={minHeight}
          maxWidth={maxWidth}
          maxHeight={maxHeight}
        />
      )}
    </div>
  );
}
