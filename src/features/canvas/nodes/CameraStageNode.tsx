import { UI_ICON_SIZE_CLASS } from '@/components/ui/styleTokens'
import { useCameraStageNodeRenderProgress } from '@/features/canvas/application/cameraStageRenderProgress';
import { useProjectStore } from '@/stores/projectStore';
import { useNodeHandlesSync } from '../hooks/useNodeHandlesSync';
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { ICON_TOOL_CAMERA_STAGE } from '@/core/theme/icons';
import { useStoreWithEqualityFn } from 'zustand/traditional';

import {
  CANVAS_NODE_TYPES,
  EXPORT_RESULT_NODE_MIN_HEIGHT,
  EXPORT_RESULT_NODE_MIN_WIDTH,
  type CameraStageNodeData,
} from '@/features/canvas/domain/canvasNodes';
import { openCameraStageNodeEditorDialog } from '@/features/canvas/application/cameraStageNodeEditor';
import {
  areMediaOutputListsEqual,
  collectInputMediaByKind,
} from '@/features/canvas/application/graphMediaResolver';
import {
  resolveMinEdgeFittedSize,
  resolveResizeMinConstraintsByAspect,
} from '@/features/canvas/application/imageNodeSizing';
import { parseAspectRatio, resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import { NODE_IDLE_BORDER_CLASS, NODE_PORT_NODE_CLASS, NODE_PORT_VISIBLE_CLASS, NODE_SELECTED_BORDER_CLASS, NODE_SURFACE_CLASS } from '@/features/canvas/ui/nodeControlStyles';
import { getSocketColor, mediaPortId } from '@/features/canvas/domain/socketTypes';
import { canvasViewStore, useCanvasStore } from '@/stores/canvasStore';
import { createLogger } from '@/core/logging';
import { applyProjectEnvironmentImage } from '@/features/cameraStage/projects/cameraStageProjectService';
import { CameraStagePreviewPanel } from './cameraStage/CameraStagePreviewPanel';
import { CameraStageEnvironmentChip } from './cameraStage/CameraStageEnvironmentChip';
import { UI_DROP_TARGET_OVERLAY_CLASS, useFileDropTarget } from '@/components/ui';
import { acceptsFileAttribute, importDroppedMedia } from '@/services/localMediaImport';

const ACCEPT_IMAGE = acceptsFileAttribute('image/*');

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

export const CameraStageNode = memo(({ id, data, selected, width }: CameraStageNodeProps) => {
  const canvasProjectId = useProjectStore((state) => state.currentProjectId);
  const renderProgress = useCameraStageNodeRenderProgress(canvasProjectId, id);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const edges = useCanvasStore((state) => state.edges);
  const upstreamImages = useStoreWithEqualityFn(
    canvasViewStore,
    (state) => collectInputMediaByKind(id, state.nodes, state.edges, 'image'),
    areMediaOutputListsEqual,
  );
  const sourceHandles = useMemo(
    () => new Set(edges.filter((edge) => edge.source === id).map((edge) => edge.sourceHandle ?? 'source')),
    [edges, id],
  );
  const environmentPortId = mediaPortId('image');
  const environmentLinked = useMemo(
    () => edges.some((edge) => edge.target === id && edge.targetHandle === environmentPortId),
    [edges, environmentPortId, id],
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
  // 节点就是画面：高按宽和画面比例算，不用存下的高（旧版节点的高里还算着底下一行，会留黑边）
  const resolvedHeight = Math.round(resolvedWidth / Math.max(0.1, parseAspectRatio(resolvedAspectRatio)));
  const imageSource = data.previewImageUrl || data.imageUrl;
  const inlineImages = data.mediaInputs?.image ?? [];
  const environmentImageUrl = upstreamImages[0]?.url ?? inlineImages[0] ?? null;
  const lastEnvironmentSyncRef = useRef<string | null>(null);

  useEffect(() => {
    if (data.environmentImageUrl === environmentImageUrl) return;
    updateNodeData(id, { environmentImageUrl }, { skipHistory: true });
  }, [data.environmentImageUrl, environmentImageUrl, id, updateNodeData]);

  useEffect(() => {
    if (!data.projectId) return;
    const syncKey = `${data.projectId}\u0000${environmentImageUrl ?? ''}`;
    if (lastEnvironmentSyncRef.current === syncKey) return;
    lastEnvironmentSyncRef.current = syncKey;
    void applyProjectEnvironmentImage(data.projectId, environmentImageUrl).catch((error: unknown) => {
      lastEnvironmentSyncRef.current = null;
      logger.error('画布全景环境同步失败', error, {
        event: 'canvas.camera_stage.environment_sync.failed',
        context: { nodeId: id, projectId: data.projectId },
      });
    });
  }, [data.projectId, environmentImageUrl, id]);

  const handleEnvironmentChange = useCallback((imageUrl: string | null): void => {
    updateNodeData(id, {
      mediaInputs: { ...data.mediaInputs, image: imageUrl ? [imageUrl] : [] },
      environmentImageUrl: imageUrl,
    });
  }, [data.mediaInputs, id, updateNodeData]);

  useNodeHandlesSync(id, `${resolvedHeight}:${resolvedWidth}`);

  // 图片拖到节点上任意位置就设为环境图；环境图来自连线时由上游决定，不接收拖放
  const environmentDrop = useFileDropTarget({
    accept: ACCEPT_IMAGE,
    disabled: environmentLinked || upstreamImages.length > 0,
    onDropFiles: ([item]) => {
      void importDroppedMedia(item, 'image').then(handleEnvironmentChange).catch((error: unknown) => {
        logger.error('镜头参考环境图拖入失败', error, { event: 'canvas.camera_stage.environment_drop.failed', context: { nodeId: id } });
      });
    },
  });

  const openEditor = useCallback(() => {
    if (renderProgress) {
      logger.warn('3D 渲染期间已阻止打开编辑器', {
        event: 'canvas.camera_stage.open.blocked_rendering',
        context: { nodeId: id, requestId: renderProgress.requestId },
      });
      return;
    }
    openCameraStageNodeEditorDialog(id);
  }, [renderProgress, id]);

  return (
    <div
      className={`
        group relative overflow-visible rounded-[var(--node-radius)] border ${NODE_SURFACE_CLASS} p-0 transition-colors duration-120
        ${selected
          ? NODE_SELECTED_BORDER_CLASS
          : NODE_IDLE_BORDER_CLASS}
      `}
      style={{ width: resolvedWidth, height: resolvedHeight }}
      onClick={() => setSelectedNode(id)}
      onDoubleClick={openEditor}
      {...environmentDrop.dropProps}
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={<ICON_TOOL_CAMERA_STAGE className={`${UI_ICON_SIZE_CLASS.md}`} />}
        titleText={resolveNodeDisplayName(CANVAS_NODE_TYPES.cameraStage, data)}
        editable
        onTitleChange={(displayName) => updateNodeData(id, { displayName })}
      />

      {/* 节点就是画面：大小按画面比例算，环境图与“打开”叠在画面上 */}
      <div className="relative h-full overflow-hidden rounded-[inherit]">
        <CameraStagePreviewPanel
          imageSource={imageSource ? resolveImageDisplayUrl(imageSource) : null}
          imageViewerSource={data.imageUrl ? resolveImageDisplayUrl(data.imageUrl) : null}
          rendering={renderProgress !== null}
          renderProgress={renderProgress?.progress ?? null}
          renderPhase={renderProgress?.phase ?? null}
          renderError={data.imageRenderError ?? data.videoRenderError ?? null}
          onOpen={openEditor}
        />
        <CameraStageEnvironmentChip
          imageUrl={environmentImageUrl}
          linked={environmentLinked || upstreamImages.length > 0}
          pinned={Boolean(selected)}
          onChange={handleEnvironmentChange}
        />
        {environmentDrop.isDragOver ? <div aria-hidden="true" className={UI_DROP_TARGET_OVERLAY_CLASS} /> : null}
      </div>

      <Handle
        type="target"
        id={environmentPortId}
        position={Position.Left}
        className={`${NODE_PORT_NODE_CLASS} ${environmentLinked ? NODE_PORT_VISIBLE_CLASS : ''}`}
        style={{ background: getSocketColor('IMAGE'), left: 0, top: '50%', transform: 'translate(-50%, -50%)' }}
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
        keepAspectRatio
      />
    </div>
  );
});

CameraStageNode.displayName = 'CameraStageNode';
