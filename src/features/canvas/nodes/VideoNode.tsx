import { memo, useCallback, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Play, Upload, Video } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  CANVAS_NODE_TYPES,
  EXPORT_RESULT_NODE_MIN_HEIGHT,
  EXPORT_RESULT_NODE_MIN_WIDTH,
  type CanvasNodeType,
  type VideoMediaNodeData,
} from '@/features/canvas/domain/canvasNodes';
import {
  resolveMinEdgeFittedSize,
  resolveResizeMinConstraintsByAspect,
} from '@/features/canvas/application/imageNodeSizing';
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import { captureVideoPoster } from '@/features/canvas/generation/videoPoster';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import {
  NODE_PORT_NODE_CLASS,
  NODE_PORT_VISIBLE_CLASS,
} from '@/features/canvas/ui/nodeControlStyles';
import { getSocketColor } from '@/features/canvas/domain/socketTypes';
import { useGenerationProgressDisplay } from '@/features/canvas/nodes/shared/useGenerationProgressDisplay';
import { formatDuration } from '@/utils/mediaDimensions';
import { saveUploadVideo } from '@/utils/save';
import { useCanvasStore } from '@/stores/canvasStore';
import { UiInput } from '@/components/ui';
import { VideoViewerModal } from '@/components/mediaViewer/VideoViewerModal';

type VideoNodeProps = NodeProps & {
  id: string;
  data: VideoMediaNodeData;
  selected?: boolean;
};

function resolveNodeDimension(value: number | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 1) {
    return Math.round(value);
  }
  return fallback;
}

/** 视频展示节点：服务于结果视频与上传视频两种类型，poster 优先、点击播放才挂载 video */
export const VideoNode = memo(({ id, data, selected, type, width, height }: VideoNodeProps) => {
  const { t } = useTranslation();
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const hasTargetConnections = useCanvasStore(
    (state) => state.edges.some((edge) => edge.target === id && (edge.targetHandle ?? 'target') === 'target')
  );
  const hasSourceConnections = useCanvasStore(
    (state) => state.edges.some((edge) => edge.source === id && (edge.sourceHandle ?? 'source') === 'source')
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isViewerOpen, setIsViewerOpen] = useState(false);

  const isUploadVariant = type === CANVAS_NODE_TYPES.videoUpload;
  const { isGenerating, progress } = useGenerationProgressDisplay(id, data);

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

  const resolvedTitle = useMemo(
    () => resolveNodeDisplayName(type as CanvasNodeType, data),
    [data, type]
  );

  const posterSource = useMemo(
    () => (data.previewImageUrl ? resolveImageDisplayUrl(data.previewImageUrl) : null),
    [data.previewImageUrl]
  );
  const videoSource = useMemo(
    () => (data.videoUrl ? resolveImageDisplayUrl(data.videoUrl) : null),
    [data.videoUrl]
  );
  const durationLabel = useMemo(
    () => (typeof data.durationSec === 'number' && data.durationSec > 0
      ? formatDuration(data.durationSec)
      : null),
    [data.durationSec]
  );

  const processFile = useCallback(async (file: File) => {
    const saved = await saveUploadVideo(file, 'persist');
    const poster = await captureVideoPoster(saved.fullPath);
    updateNodeData(id, {
      videoUrl: saved.fullPath,
      previewImageUrl: poster.posterUrl,
      aspectRatio: poster.aspectRatio,
      durationSec: poster.durationSec,
      sourceFileName: file.name,
    });
    setIsPlaying(false);
  }, [id, updateNodeData]);

  const handleFileChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !file.type.startsWith('video/')) {
      return;
    }
    await processFile(file);
    event.target.value = '';
  }, [processFile]);

  const handleDrop = useCallback(async (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith('video/')) {
      return;
    }
    await processFile(file);
  }, [processFile]);

  const handleNodeClick = useCallback(() => {
    setSelectedNode(id);
    if (isUploadVariant && !data.videoUrl) {
      inputRef.current?.click();
    }
  }, [data.videoUrl, id, isUploadVariant, setSelectedNode]);

  return (
    <div
      className={`
        group relative overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/85 p-0 transition-colors duration-150
        ${selected
          ? 'border-accent shadow-[0_0_0_1px_rgba(59,130,246,0.32)]'
          : 'border-[rgba(255,255,255,0.22)] hover:border-[rgba(255,255,255,0.34)]'}
      `}
      style={{ width: resolvedWidth, height: resolvedHeight }}
      onClick={handleNodeClick}
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={isUploadVariant ? <Upload className="h-4 w-4" /> : <Video className="h-4 w-4" />}
        titleText={resolvedTitle}
        editable
        onTitleChange={(nextTitle) => updateNodeData(id, { displayName: nextTitle })}
      />

      <div className="relative h-full w-full overflow-hidden rounded-[var(--node-radius)] bg-bg-dark">
        {videoSource && isPlaying ? (
          <video
            className="nodrag nowheel h-full w-full object-contain"
            src={videoSource}
            poster={posterSource ?? undefined}
            controls
            autoPlay
            preload="none"
            onMouseDown={(event) => event.stopPropagation()}
            onEnded={() => setIsPlaying(false)}
          />
        ) : data.videoUrl ? (
          <>
            {posterSource ? (
              <img
                src={posterSource}
                alt={resolvedTitle}
                className="h-full w-full object-contain"
                draggable={false}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-text-muted/85">
                <Video className="h-7 w-7 opacity-60" />
              </div>
            )}
            <div
              className="absolute inset-0 flex cursor-pointer items-center justify-center"
              onClick={(event) => {
                event.stopPropagation();
                setSelectedNode(id);
                setIsPlaying(true);
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                setIsPlaying(false);
                setIsViewerOpen(true);
              }}
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-bg-dark/70 text-text-dark transition-transform duration-150 group-hover:scale-105">
                <Play className="ml-0.5 h-5 w-5" />
              </span>
            </div>
            {durationLabel && (
              <span className="absolute bottom-1.5 right-1.5 rounded bg-bg-dark/75 px-1.5 py-0.5 text-[10px] leading-none text-text-dark">
                {durationLabel}
              </span>
            )}
          </>
        ) : isUploadVariant ? (
          <label
            className="flex h-full w-full cursor-pointer flex-col items-center justify-center gap-2 text-text-muted/85"
            onDrop={handleDrop}
            onDragOver={(event) => event.preventDefault()}
          >
            <Upload className="h-7 w-7 opacity-60" />
            <span className="px-3 text-center text-[12px] leading-6">{t('node.videoNode.uploadHint')}</span>
          </label>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-text-muted/85">
            <Video className="h-7 w-7 opacity-60" />
            <span className="px-4 text-center text-[12px] leading-6">{t('node.videoNode.waitingResult')}</span>
          </div>
        )}

        {isGenerating && (
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute inset-0 bg-bg-dark/55" />
            <div
              className="absolute left-0 top-0 h-full bg-gradient-to-r from-[rgba(255,255,255,0.4)] to-[rgba(255,255,255,0.06)] transition-[width] duration-100 ease-linear"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        )}
      </div>

      {isUploadVariant && (
        <UiInput
          ref={inputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={handleFileChange}
        />
      )}

      {isViewerOpen && videoSource && (
        <VideoViewerModal
          open={isViewerOpen}
          videoUrl={videoSource}
          onClose={() => setIsViewerOpen(false)}
        />
      )}

      {!isUploadVariant && (
        <Handle
          type="target"
          id="target"
          position={Position.Left}
          className={`${NODE_PORT_NODE_CLASS} ${hasTargetConnections ? NODE_PORT_VISIBLE_CLASS : ''}`}
          style={{ background: getSocketColor('VIDEO'), left: 0, top: '50%', transform: 'translate(-50%, -50%)' }}
        />
      )}
      <Handle
        type="source"
        id="source"
        position={Position.Right}
        className={`${NODE_PORT_NODE_CLASS} ${hasSourceConnections ? NODE_PORT_VISIBLE_CLASS : ''}`}
        style={{ background: getSocketColor('VIDEO'), right: 0, top: '50%', transform: 'translate(50%, -50%)' }}
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

VideoNode.displayName = 'VideoNode';
