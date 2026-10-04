import { reportCanvasOperationFailure } from '@/features/canvas/application/canvasOperationFeedback';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react';

import type { CanvasEdge } from '@/features/canvas/domain/canvasNodes';
import { disconnectAssetGroup } from '@/features/canvas/application/assetGroupApplicationService';
import { EdgeDisconnectButton } from './EdgeDisconnectButton';

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
  const { t } = useTranslation();
  const [path, labelX, labelY] = useMemo(
    () => getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition }),
    [sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition],
  );
  const bundle = data?.assetGroupBundle;
  if (!bundle) return <BaseEdge id={id} path={path} markerEnd={markerEnd} />;

  const summary = [
    t('canvas.edge.bundleConnected', { count: bundle.connected }),
    bundle.pending > 0 ? t('canvas.edge.bundlePending', { count: bundle.pending }) : null,
    bundle.excluded > 0 ? t('canvas.edge.bundleExcluded', { count: bundle.excluded }) : null,
  ].filter(Boolean).join(' · ');

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        // 强调色只表达选中（与普通连线一致）；素材组连线静息用次要文字色 + 加粗，与普通连线区分
        style={{
          stroke: selected ? 'rgb(var(--accent-rgb))' : 'rgb(var(--text2-rgb))',
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
          {/* 连接摘要是只读标签（压在画布上，走玻璃），不是按钮 */}
          <span className="ui-glass inline-flex h-6 items-center rounded-full px-2 text-2xs text-text1">
            {summary}
          </span>
          {selected && (
            <EdgeDisconnectButton
              label={t('canvas.edge.disconnectAssetGroup')}
              onDisconnect={() => {
                void disconnectAssetGroup({ groupId: bundle.groupId, targetNodeId: bundle.targetNodeId }).catch(reportCanvasOperationFailure);
              }}
            />
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
});
