import { memo, useCallback, useEffect, useMemo } from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { Clapperboard } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  CANVAS_NODE_TYPES,
  EXPORT_RESULT_NODE_DEFAULT_WIDTH,
  EXPORT_RESULT_NODE_LAYOUT_HEIGHT,
  EXPORT_RESULT_NODE_MIN_HEIGHT,
  EXPORT_RESULT_NODE_MIN_WIDTH,
  type CameraStageNodeData,
  isCameraStageNode,
} from '@/features/canvas/domain/canvasNodes';
import { canvasEventBus } from '@/features/canvas/application/canvasServices';
import {
  resolveMinEdgeFittedSize,
  resolveResizeMinConstraintsByAspect,
} from '@/features/canvas/application/imageNodeSizing';
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import { NODE_PORT_NODE_CLASS, NODE_PORT_VISIBLE_CLASS } from '@/features/canvas/ui/nodeControlStyles';
import { getSocketColor } from '@/features/canvas/domain/socketTypes';
import { useCanvasStore } from '@/stores/canvasStore';
import { createLogger } from '@/core/logging';
import { CameraStagePreviewPanel } from './cameraStage/CameraStagePreviewPanel';

type CameraStageNodeProps = NodeProps & {
  id: string;
  data: CameraStageNodeData;
  selected?: boolean;
};

const logger = createLogger('features.canvas.cameraStage');

function resolveNodeDimension(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 1
    ? Math.round(value)
    : fallback;
}

export const CameraStageNode = memo(({ id, data, selected, width, height }: CameraStageNodeProps) => {
  const { t } = useTranslation();
  const updateNodeInternals = useUpdateNodeInternals();
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const addNode = useCanvasStore((state) => state.addNode);
  const addEdge = useCanvasStore((state) => state.addEdge);
  const findNodePosition = useCanvasStore((state) => state.findNodePosition);
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const edges = useCanvasStore((state) => state.edges);
  const sourceHandles = useMemo(
    () => new Set(edges.filter((edge) => edge.source === id).map((edge) => edge.sourceHandle ?? 'source')),
    [edges, id],
  );
  const resolvedAspectRatio = data.aspectRatio || '16:9';
  const compactSize = resolveMinEdgeFittedSize(resolvedAspectRatio, {
    minWidth: EXPORT_RESULT_NODE_MIN_WIDTH,
    minHeight: EXPORT_RESULT_NODE_MIN_HEIGHT,
  });
  const resizeConstraints = resolveResizeMinConstraintsByAspect(resolvedAspectRatio, {
    minWidth: EXPORT_RESULT_NODE_MIN_WIDTH,
    minHeight: EXPORT_RESULT_NODE_MIN_HEIGHT,
  });
  const resolvedWidth = resolveNodeDimension(width, compactSize.width);
  const resolvedHeight = resolveNodeDimension(height, compactSize.height);
  const imageSource = data.previewImageUrl || data.imageUrl;

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, resolvedHeight, resolvedWidth, updateNodeInternals]);

  const openEditor = useCallback(() => {
    if (data.videoExporting) {
      logger.warn('3D 视频渲染期间已阻止打开编辑器', {
        event: 'canvas.camera_stage.open.blocked_rendering',
        context: { nodeId: id, requestId: data.videoRenderRequestId },
      });
      return;
    }
    canvasEventBus.publish('camera-stage/open', { nodeId: id });
  }, [data.videoExporting, data.videoRenderRequestId, id]);

  const createOutputNode = useCallback((kind: 'image' | 'video'): void => {
    const currentNode = useCanvasStore.getState().nodes.find((node) => node.id === id);
    if (!isCameraStageNode(currentNode)) return;
    const currentData = currentNode.data;
    const mediaUrl = kind === 'image' ? currentData.imageUrl : currentData.videoUrl;
    if (!mediaUrl) return;

    const position = findNodePosition(
      id,
      EXPORT_RESULT_NODE_DEFAULT_WIDTH,
      EXPORT_RESULT_NODE_LAYOUT_HEIGHT,
    );
    const outputNodeId = kind === 'image'
      ? addNode(CANVAS_NODE_TYPES.exportImage, position, {
          imageUrl: mediaUrl,
          previewImageUrl: currentData.previewImageUrl ?? mediaUrl,
          aspectRatio: currentData.aspectRatio,
          displayName: t('node.cameraStage.imageResultTitle'),
          resultKind: 'generic',
        })
      : addNode(CANVAS_NODE_TYPES.exportVideo, position, {
          videoUrl: mediaUrl,
          // 3D 节点上的 previewImageUrl 是用户手动保存的静态画面，可能来自任意时间点，
          // 不能作为新视频的 poster；视频节点会直接解码并展示自己的第 0 帧。
          previewImageUrl: null,
          aspectRatio: currentData.aspectRatio,
          durationSec: currentData.durationSec,
          displayName: t('node.cameraStage.videoResultTitle'),
        });
    addEdge(id, outputNodeId);
    logger.info('画布 3D 镜头参考已创建输出节点', {
      event: 'canvas.camera_stage.output.completed',
      context: { nodeId: id, outputNodeId, kind },
    });
  }, [addEdge, addNode, findNodePosition, id, t]);

  useEffect(() => canvasEventBus.subscribe('camera-stage/output', ({ nodeId, kind }) => {
    if (nodeId === id) createOutputNode(kind);
  }), [createOutputNode, id]);

  return (
    <div
      className={`
        group relative overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/85 p-0 transition-colors duration-150
        ${selected
          ? 'border-accent shadow-[0_0_0_1px_rgba(59,130,246,0.32)]'
          : 'border-[rgba(255,255,255,0.22)] hover:border-[rgba(255,255,255,0.34)]'}
      `}
      style={{ width: resolvedWidth, height: resolvedHeight }}
      onClick={() => setSelectedNode(id)}
      onDoubleClick={openEditor}
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={<Clapperboard className="h-4 w-4" />}
        titleText={resolveNodeDisplayName(CANVAS_NODE_TYPES.cameraStage, data)}
        editable
        onTitleChange={(displayName) => updateNodeData(id, { displayName })}
      />

      <CameraStagePreviewPanel
        imageSource={imageSource ? resolveImageDisplayUrl(imageSource) : null}
        imageViewerSource={data.imageUrl ? resolveImageDisplayUrl(data.imageUrl) : null}
        videoExporting={Boolean(data.videoExporting)}
        videoProgress={data.videoProgress ?? null}
        videoRenderPhase={data.videoRenderPhase ?? null}
        videoRenderError={data.videoRenderError ?? null}
      />

      <Handle
        type="source"
        id="source"
        position={Position.Right}
        isConnectable={false}
        className={`${NODE_PORT_NODE_CLASS} ${sourceHandles.has('source') ? NODE_PORT_VISIBLE_CLASS : ''}`}
        style={{ background: getSocketColor('*'), right: 0, top: '50%', transform: 'translate(50%, -50%)' }}
      />
      <NodeResizeHandle
        minWidth={resizeConstraints.minWidth}
        minHeight={resizeConstraints.minHeight}
        maxWidth={1600}
        maxHeight={1600}
      />
    </div>
  );
});

CameraStageNode.displayName = 'CameraStageNode';
