import { memo, useMemo } from 'react';
import { CircleX } from 'lucide-react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react';

import { UiChipButton, UiIconButton } from '@/components/ui';
import type { CanvasEdge } from '@/features/canvas/domain/canvasNodes';
import { disconnectAssetGroup } from '@/features/canvas/application/assetGroupApplicationService';

export const AssetGroupBundleEdge = memo(function AssetGroupBundleEdge(props: EdgeProps<CanvasEdge>) {
  const {
    id,
    selected,
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    markerEnd,
    data,
  } = props;
  const [path, labelX, labelY] = useMemo(
    () => getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition }),
    [sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition],
  );
  const bundle = data?.assetGroupBundle;
  if (!bundle) return <BaseEdge id={id} path={path} markerEnd={markerEnd} />;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: 'rgb(var(--accent-rgb) / 0.9)',
          strokeWidth: selected ? 3.2 : 2.7,
        }}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan absolute flex items-center gap-1"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
          }}
        >
          <UiChipButton className="h-6 cursor-default rounded-full px-2 text-2xs text-text-dark">
            {bundle.connected} 已连接
            {bundle.pending > 0 ? ` · ${bundle.pending} 待连接` : ''}
            {bundle.excluded > 0 ? ` · ${bundle.excluded} 已排除` : ''}
          </UiChipButton>
          {selected && (
            <UiIconButton
              className="h-6 w-6 rounded-full"
              aria-label="解除素材组绑定"
              onClick={(event) => {
                event.stopPropagation();
                disconnectAssetGroup({ groupId: bundle.groupId, targetNodeId: bundle.targetNodeId });
              }}
            >
              <CircleX className="h-4 w-4" />
            </UiIconButton>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
});
