import type { ReactNode } from 'react';
import { Handle, Position } from '@xyflow/react';

import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import { getSocketColor } from '@/features/canvas/domain/socketTypes';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeLodPlaceholder } from '@/features/canvas/ui/NodeLodPlaceholder';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import {
  NODE_IDLE_BORDER_CLASS,
  NODE_PORT_NODE_CLASS,
  NODE_PORT_VISIBLE_CLASS,
  NODE_SELECTED_BORDER_CLASS,
} from '@/features/canvas/ui/nodeControlStyles';

interface ToolWorkbenchNodeFrameProps {
  nodeId: string;
  title: string;
  icon: ReactNode;
  selected?: boolean;
  width?: number;
  height?: number;
  hasSourceConnections: boolean;
  onSelect: () => void;
  onTitleChange: (title: string) => void;
  rightSlot?: ReactNode;
  children: ReactNode;
  defaultWidth?: number;
  defaultHeight?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  dataAttributes?: Readonly<Record<`data-${string}`, string | number | undefined>>;
}

export function ToolWorkbenchNodeFrame({
  nodeId,
  title,
  icon,
  selected,
  width,
  height,
  hasSourceConnections,
  onSelect,
  onTitleChange,
  rightSlot,
  children,
  defaultWidth = 680,
  defaultHeight = 360,
  minWidth = 600,
  minHeight = 300,
  maxWidth = 1400,
  maxHeight = 1000,
  dataAttributes,
}: ToolWorkbenchNodeFrameProps): JSX.Element {
  const resolvedWidth = Math.max(minWidth, typeof width === 'number' ? width : defaultWidth);
  const resolvedHeight = Math.max(minHeight, typeof height === 'number' ? height : defaultHeight);

  return (
    <div
      {...dataAttributes}
      data-tool-workbench-node-id={nodeId}
      className={`group relative flex overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/90 p-2 transition-colors duration-150 ${
        selected ? NODE_SELECTED_BORDER_CLASS : NODE_IDLE_BORDER_CLASS
      }`}
      style={{ width: resolvedWidth, height: resolvedHeight }}
      onClick={onSelect}
    >
      <NodeHeader
        className={`${NODE_HEADER_FLOATING_POSITION_CLASS} canvas-node-lod-detail`}
        icon={icon}
        titleText={title}
        editable
        onTitleChange={onTitleChange}
        rightSlot={rightSlot}
      />
      <NodeLodPlaceholder title={title} icon={icon} />
      <div className="canvas-node-lod-detail nodrag nowheel flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg bg-bg-dark/45">
        {children}
      </div>
      <Handle
        type="source"
        id="source"
        position={Position.Right}
        className={`${NODE_PORT_NODE_CLASS} ${hasSourceConnections ? NODE_PORT_VISIBLE_CLASS : ''}`}
        style={{
          background: getSocketColor('IMAGE'),
          right: 0,
          top: '50%',
          transform: 'translate(50%, -50%)',
        }}
      />
      <NodeResizeHandle
        minWidth={minWidth}
        minHeight={minHeight}
        maxWidth={maxWidth}
        maxHeight={maxHeight}
      />
    </div>
  );
}

interface ToolWorkbenchSourcePreviewProps {
  source: string | null;
  alt: string;
  icon: ReactNode;
  emptyText: string;
  summary?: ReactNode;
  children?: ReactNode;
}

export function ToolWorkbenchSourcePreview({
  source,
  alt,
  icon,
  emptyText,
  summary,
  children,
}: ToolWorkbenchSourcePreviewProps): JSX.Element {
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden">
      {source ? (
        <img
          src={resolveImageDisplayUrl(source)}
          alt={alt}
          className="pointer-events-none h-full w-full select-none object-contain"
          draggable={false}
        />
      ) : (
        <div className="flex flex-col items-center gap-2 px-6 text-center text-text-muted">
          {icon}
          <span className="text-xs">{emptyText}</span>
        </div>
      )}
      {summary && (
        <div className="pointer-events-none absolute bottom-2 left-2 right-2 rounded-lg bg-overlay px-2.5 py-1.5 text-2xs text-text-soft">
          {summary}
        </div>
      )}
      {children}
    </div>
  );
}
