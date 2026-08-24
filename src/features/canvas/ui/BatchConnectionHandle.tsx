import { useCallback, useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { NodeToolbar, Position } from '@xyflow/react';
import { Cable } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiIconButton, UiPanel } from '@/components/ui';
import { resolveMediaConnectionSource } from '@/features/canvas/application/mediaConnectionPlanner';
import type { CanvasNode } from '@/features/canvas/domain/canvasNodes';

interface BatchConnectionHandleProps {
  nodes: CanvasNode[];
  onConnect: (sourceNodeIds: string[], targetNodeId: string) => void;
}

interface DragLine {
  start: { x: number; y: number };
  end: { x: number; y: number };
}

function connectionPath(line: DragLine): string {
  const distance = Math.max(60, Math.abs(line.end.x - line.start.x) * 0.45);
  return `M ${line.start.x} ${line.start.y} C ${line.start.x + distance} ${line.start.y}, ${line.end.x - distance} ${line.end.y}, ${line.end.x} ${line.end.y}`;
}

export function BatchConnectionHandle({ nodes, onConnect }: BatchConnectionHandleProps) {
  const { t } = useTranslation();
  const [dragLine, setDragLine] = useState<DragLine | null>(null);
  const sourceNodeIds = useMemo(
    () => nodes.filter((node) => resolveMediaConnectionSource(node)).map((node) => node.id),
    [nodes],
  );

  useEffect(() => () => {
    document.body.classList.remove('cursor-crosshair');
  }, []);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || sourceNodeIds.length < 2) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const start = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    setDragLine({ start, end: { x: event.clientX, y: event.clientY } });
    document.body.classList.add('cursor-crosshair');

    const handleMove = (moveEvent: PointerEvent) => {
      setDragLine({ start, end: { x: moveEvent.clientX, y: moveEvent.clientY } });
    };
    const handleUp = (upEvent: PointerEvent) => {
      document.removeEventListener('pointermove', handleMove, true);
      document.removeEventListener('pointerup', handleUp, true);
      document.body.classList.remove('cursor-crosshair');
      setDragLine(null);
      const element = document.elementFromPoint(upEvent.clientX, upEvent.clientY)
        ?.closest<HTMLElement>('.react-flow__node[data-id]');
      const targetNodeId = element?.dataset.id;
      if (targetNodeId && !sourceNodeIds.includes(targetNodeId)) {
        onConnect(sourceNodeIds, targetNodeId);
      }
    };
    document.addEventListener('pointermove', handleMove, true);
    document.addEventListener('pointerup', handleUp, true);
  }, [onConnect, sourceNodeIds]);

  if (sourceNodeIds.length < 2) return null;

  return (
    <>
      <NodeToolbar
        nodeId={nodes.map((node) => node.id)}
        isVisible
        position={Position.Right}
        align="center"
        offset={8}
        className="pointer-events-auto"
      >
        <UiPanel variant="glass" className="p-1">
          <UiIconButton
            appearance="hover-only"
            showBorder={false}
            className="nodrag nopan h-8 w-8 rounded-full text-brand-300"
            aria-label={t('nodeToolbar.batchConnect')}
            title={t('nodeToolbar.batchConnect')}
            onPointerDown={handlePointerDown}
          >
            <Cable className="h-4 w-4" />
          </UiIconButton>
        </UiPanel>
      </NodeToolbar>
      {dragLine && createPortal(
        // icon-token-allow：这是随指针实时计算的连接路径图形，不是可由图标替代的静态语义图标。
        <svg className="pointer-events-none fixed inset-0 z-drag h-screen w-screen overflow-visible">
          <path
            d={connectionPath(dragLine)}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            className="text-brand-300"
          />
        </svg>,
        document.body,
      )}
    </>
  );
}
