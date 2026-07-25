import { memo, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { Play, Upload, Video } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  CANVAS_NODE_TYPES,
  DEFAULT_ASPECT_RATIO,
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
import { canvasEventBus } from '@/features/canvas/application/canvasServices';
import { getMainPortConnectionFlags } from '@/features/canvas/domain/connectionIndex';
import { captureVideoPoster, detectVideoAspectRatioFromSource } from '@/features/canvas/generation/videoPoster';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import {
  NODE_GENERATION_ERROR_BORDER_CLASS,
  NODE_IDLE_BORDER_CLASS,
  NODE_PORT_NODE_CLASS,
  NODE_PORT_VISIBLE_CLASS,
  NODE_SELECTED_BORDER_CLASS,
} from '@/features/canvas/ui/nodeControlStyles';
import { getSocketColor } from '@/features/canvas/domain/socketTypes';
import { useGenerationProgressDisplay } from '@/features/canvas/nodes/shared/useGenerationProgressDisplay';
import { NodeGenerationError } from '@/features/canvas/nodes/shared/NodeGenerationError';
import { useMediaMicroLod } from '@/features/canvas/nodes/shared/useCanvasContentLod';
import { useMicroThumbnail } from '@/features/canvas/nodes/shared/useMicroThumbnail';
import { saveUploadVideo } from '@/utils/save';
import { useCanvasStore } from '@/stores/canvasStore';
import { UiIconButton, UiInput } from '@/components/ui';
import { VideoViewerModal } from '@/components/mediaViewer/VideoViewerModal';
import { CanvasNodeImage } from '@/features/canvas/ui/CanvasNodeImage';
import { CanvasVideoPlayer } from './video/CanvasVideoPlayer';

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
  const updateNodeInternals = useUpdateNodeInternals();
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const hasTargetConnections = useCanvasStore(
    (state) => getMainPortConnectionFlags(state.edges).get(id)?.hasMainTarget ?? false
  );
  const hasSourceConnections = useCanvasStore(
    (state) => getMainPortConnectionFlags(state.edges).get(id)?.hasMainSource ?? false
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadSequenceRef = useRef(0);
  const [isViewerOpen, setIsViewerOpen] = useState(false);

  const isUploadVariant = type === CANVAS_NODE_TYPES.videoUpload;
  const { isGenerating, progress, transitionDurationMs } = useGenerationProgressDisplay(id, data);
  const generationError = typeof data.generationError === 'string' ? data.generationError : null;

  const resolvedAspectRatio = data.aspectRatio || DEFAULT_ASPECT_RATIO;
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

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, resolvedWidth, resolvedHeight, updateNodeInternals]);

  const resolvedTitle = useMemo(
    () => resolveNodeDisplayName(type as CanvasNodeType, data),
    [data, type]
  );

  const videoSource = useMemo(
    () => (data.videoUrl ? resolveImageDisplayUrl(data.videoUrl) : null),
    [data.videoUrl]
  );
  const posterSource = useMemo(
    () => (data.previewImageUrl ? resolveImageDisplayUrl(data.previewImageUrl) : null),
    [data.previewImageUrl]
  );
  // 低倍率下封面降为微缩略图，生成完成前继续显示原封面
  const preferMicroImage = useMediaMicroLod();
  const microPosterSource = useMicroThumbnail(posterSource, preferMicroImage);
  const displayedPosterSource = microPosterSource ?? posterSource;

  // poster 优先：有封面时默认只渲染 <img>，点击播放才挂载 <video>。
  // 每个常驻 <video preload="auto"> 都是一个解码器实例，几十个视频节点时内存/解码开销可观。
  const [isPlayerActive, setIsPlayerActive] = useState(false);
  useEffect(() => {
    setIsPlayerActive(false);
  }, [videoSource]);
  const shouldMountPlayer = Boolean(videoSource) && (isPlayerActive || !posterSource);

  const processFile = useCallback(async (file: File) => {
    const sequence = uploadSequenceRef.current + 1;
    uploadSequenceRef.current = sequence;

    // 先用本地文件直接探测宽高比，不等待落盘 + 抓帧的完整流程，
    // 让节点尺寸尽快重新适配，避免“先维持旧尺寸、稍后才跳变”的延迟感
    const optimisticBlobUrl = URL.createObjectURL(file);
    detectVideoAspectRatioFromSource(optimisticBlobUrl)
      .then((ratio) => {
        if (uploadSequenceRef.current === sequence) {
          updateNodeData(id, { aspectRatio: ratio });
        }
      })
      .catch(() => {
        // 探测失败时静默忽略，最终尺寸仍由下方 captureVideoPoster 的结果兜底
      })
      .finally(() => URL.revokeObjectURL(optimisticBlobUrl));

    const saved = await saveUploadVideo(file, 'persist');
    const poster = await captureVideoPoster(saved.fullPath);
    if (uploadSequenceRef.current !== sequence) {
      return;
    }
    updateNodeData(id, {
      videoUrl: saved.fullPath,
      previewImageUrl: poster.posterUrl,
      aspectRatio: poster.aspectRatio,
      durationSec: poster.durationSec,
      sourceFileName: file.name,
    });
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

  useEffect(() => {
    return canvasEventBus.subscribe('canvas/paste-media', ({ nodeId, file }) => {
      if (nodeId !== id || !file.type.startsWith('video/')) {
        return;
      }
      void processFile(file);
    });
  }, [id, processFile]);

  return (
    <div
      className={`
        group relative overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/85 p-0 transition-colors duration-150
        ${generationError
          ? NODE_GENERATION_ERROR_BORDER_CLASS
          : selected
            ? NODE_SELECTED_BORDER_CLASS
            : NODE_IDLE_BORDER_CLASS}
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
        {generationError ? null : videoSource && shouldMountPlayer ? (
          <CanvasVideoPlayer
            src={videoSource}
            knownDuration={data.durationSec}
            onOpenViewer={() => setIsViewerOpen(true)}
            autoPlayOnMount={isPlayerActive}
          />
        ) : videoSource && posterSource ? (
          <div
            className="group/poster relative h-full w-full"
            onDoubleClick={(event) => {
              event.stopPropagation();
              setIsViewerOpen(true);
            }}
          >
            <CanvasNodeImage
              src={displayedPosterSource ?? ''}
              alt={resolvedTitle}
              className="pointer-events-none h-full w-full select-none object-contain"
              disableViewer
              draggable={false}
            />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <UiIconButton
                aria-label={t('node.videoNode.play')}
                showBorder={false}
                className="nodrag nowheel pointer-events-auto !h-11 !w-11 !rounded-full !border-white/15 !bg-black/50 !text-white shadow-panel backdrop-blur-md hover:!bg-black/65"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  setIsPlayerActive(true);
                }}
              >
                <Play className="ml-0.5 h-5 w-5" />
              </UiIconButton>
            </div>
          </div>
        ) : isUploadVariant ? (
          <label
            className="flex h-full w-full cursor-pointer flex-col items-center justify-center gap-2 text-text-muted/85"
            onDrop={handleDrop}
            onDragOver={(event) => event.preventDefault()}
          >
            <Upload className="h-7 w-7 opacity-60" />
            <span className="px-3 text-center text-xs leading-6">{t('node.videoNode.uploadHint')}</span>
          </label>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-text-muted/85">
            <Video className="h-7 w-7 opacity-60" />
            <span className="px-4 text-center text-xs leading-6">{t('node.videoNode.waitingResult')}</span>
          </div>
        )}

        {isGenerating && (
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute inset-0 bg-bg-dark/55" />
            <div
              className="absolute left-0 top-0 h-full w-full origin-left bg-gradient-to-r from-veil-bright to-veil-faint ease-out"
              style={{ transform: `scaleX(${progress})`, transition: `transform ${transitionDurationMs}ms ease-out` }}
            />
          </div>
        )}

        {generationError && <NodeGenerationError message={generationError} />}
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
