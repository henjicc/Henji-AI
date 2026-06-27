import { memo, useMemo } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react';

import { getNodeIndexById } from '@/features/canvas/domain/connectionIndex';
import { getNodeDefinition } from '@/features/canvas/domain/nodeRegistry';
import { UiIconButton } from '@/components/ui';
import { useCanvasStore } from '@/stores/canvasStore';

export const DisconnectableEdge = memo(function DisconnectableEdge(props: EdgeProps) {
  const {
    id,
    target,
    selected,
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    markerEnd,
    style,
  } = props;
  const deleteEdge = useCanvasStore((state) => state.deleteEdge);
  // 生成中判定：下游是结果展示节点且正在生成（按注册表 media.role 泛化，无节点类型特判）
  const isProcessingEdge = useCanvasStore((state) => {
    const targetNode = getNodeIndexById(state.nodes).get(target);
    if (!targetNode || targetNode.data?.isGenerating !== true) {
      return false;
    }
    return getNodeDefinition(targetNode.type)?.media?.role === 'result';
  });

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const processingStroke = useMemo(() => 'rgb(var(--accent-rgb) / 0.94)', []);
  const baseStrokeWidth = isProcessingEdge
    ? (selected ? 2.7 : 2.2)
    : (selected ? 2.4 : 1.9);

  return (
    <>
      {isProcessingEdge && (
        <path
          d={edgePath}
          fill="none"
          stroke="rgb(var(--accent-rgb) / 1)"
          strokeWidth={selected ? 2.5 : 2.1}
          strokeLinecap="round"
          strokeDasharray="8 10"
          className="canvas-processing-edge__flow"
          style={{ pointerEvents: 'none' }}
        />
      )}
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: isProcessingEdge ? processingStroke : style?.stroke,
          strokeWidth: baseStrokeWidth,
          ...style,
        }}
      />
      {selected && (
        <EdgeLabelRenderer>
          <UiIconButton
            type="button"
            className="nodrag nopan absolute !h-6 !w-6 rounded-full !p-0 text-text-muted hover:text-text-dark"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
            }}
            onClick={(event) => {
              event.stopPropagation();
              deleteEdge(id);
            }}
            aria-label="断开连线"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24">
              <path
                fill="currentColor"
                fillRule="evenodd"
                d="M2 12C2 6.477 6.477 2 12 2s10 4.477 10 10s-4.477 10-10 10S2 17.523 2 12m7.707-3.707a1 1 0 0 0-1.414 1.414L10.586 12l-2.293 2.293a1 1 0 1 0 1.414 1.414L12 13.414l2.293 2.293a1 1 0 0 0 1.414-1.414L13.414 12l2.293-2.293a1 1 0 0 0-1.414-1.414L12 10.586z"
                clipRule="evenodd"
              />
            </svg>
          </UiIconButton>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
