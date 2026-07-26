import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Handle, Position, useReactFlow } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { useStoreWithEqualityFn } from 'zustand/traditional';
import { Image as ImageIcon, Music, Scissors, Video, X } from 'lucide-react';

import { prepareNodeImageFromFile, resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import {
  areMediaOutputListsEqual,
  collectInputMediaByKind,
} from '@/features/canvas/application/graphMediaResolver';
import { getSocketColor, mediaPortId, type RowMediaKind } from '@/features/canvas/domain/socketTypes';
import {
  NODE_ROW_CLASS,
  NODE_ROW_CONTROL_SLOT_CLASS,
  NODE_ROW_HOVER_CLASS,
  NODE_ROW_LABEL_CLASS,
  NODE_PORT_ROW_CLASS,
  NODE_PORT_VISIBLE_CLASS,
} from '@/features/canvas/ui/nodeControlStyles';
import { saveUploadAudio, saveUploadVideo } from '@/utils/save';
import { UiIconButton, UiInput } from '@/components/ui';
import { useCanvasStore } from '@/stores/canvasStore';
import { CanvasNodeImage } from '@/features/canvas/ui/CanvasNodeImage';
import { VideoViewerModal } from '@/components/mediaViewer/VideoViewerModal';
import { VideoTrimModal, type VideoTrimRange } from '@/components/videoTrim/VideoTrimModal';
import { useReorderDrag } from '@/components/ui/fileUploader/useReorderDrag';
import { readAssetDragPayload } from '@/features/assets/drag/assetDragPayload';
import { UI_DURATION, uiTransition } from '@/components/ui/motion';

interface MediaInputRowProps {
  nodeId: string;
  mediaKind: RowMediaKind;
  label: string;
  maxCount: number;
  inlineValue: string[];
  onInlineChange: (next: string[]) => void;
  /** 视频裁剪能力：来自模型 inputLimits.videoConstraints.trim，仅 mediaKind === 'video' 时有意义 */
  videoTrimMaxClipSeconds?: number;
  /** 视频体积上限（MB），存在时裁剪确认会顺带按需压缩一次完整视频 */
  videoTrimMaxSizeMB?: number;
  /** 已保存的裁剪选区（若有），重新打开裁剪窗口时用它初始化，而不是每次都从头选 */
  videoTrimRange?: VideoTrimRange | null;
  /** 确认裁剪只回传选区，不替换 inlineValue 里的视频引用——完整视频始终保留 */
  onVideoTrimRangeChange?: (range: VideoTrimRange) => void;
}

const MEDIA_ACCEPT: Record<RowMediaKind, string> = {
  image: 'image/*',
  video: 'video/*',
  audio: 'audio/*',
};

const MEDIA_ICON: Record<RowMediaKind, typeof ImageIcon> = {
  image: ImageIcon,
  video: Video,
  audio: Music,
};

interface UploadedMediaUrl {
  url: string;
  previewUrl?: string;
}

async function fileToMediaUrl(file: File, kind: RowMediaKind): Promise<UploadedMediaUrl> {
  if (kind === 'image') {
    const prepared = await prepareNodeImageFromFile(file);
    return { url: prepared.imageUrl, previewUrl: prepared.previewImageUrl };
  }
  if (kind === 'video') {
    const saved = await saveUploadVideo(file, 'persist');
    return { url: saved.fullPath };
  }
  const saved = await saveUploadAudio(file, 'persist');
  return { url: saved.fullPath };
}

function resolveFileName(url: string): string {
  const normalized = url.split(/[\\/]/).pop() ?? url;
  return normalized.length > 18 ? `${normalized.slice(0, 18)}…` : normalized;
}

function moveArrayItem<T>(list: T[], fromIndex: number, toIndex: number): T[] {
  const next = [...list];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

/**
 * 媒体输入行：缩略图槛（图片）或文件名 chip（视频/音频）+ 类型化端口。
 * 已连线（上游有该媒体类型输出）→ 只读展示上游媒体；未连线 → 槛位可本地上传。
 */
export function MediaInputRow({
  nodeId,
  mediaKind,
  label,
  maxCount,
  inlineValue,
  onInlineChange,
  videoTrimMaxClipSeconds,
  videoTrimMaxSizeMB,
  videoTrimRange,
  onVideoTrimRangeChange,
}: MediaInputRowProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [viewerVideoUrl, setViewerVideoUrl] = useState<string | null>(null);
  const [trimTargetIndex, setTrimTargetIndex] = useState<number | null>(null);
  // 节点渲染在 React Flow 缩放过的画布坐标系里：CSS transform 是"本地像素"，
  // 画布缩放会把它再放大/缩小一次，所以跟手位移、让位位移都要先除以 zoom 才能在屏幕上 1:1 还原。
  // 用 getZoom() 在拖拽开始那一刻取一次快照（而非 useViewport() 那样订阅视口、每帧重渲染）。
  const { getZoom } = useReactFlow();
  const dragZoomRef = useRef(1);
  const mediaHandleId = mediaPortId(mediaKind);

  const upstreamMedia = useStoreWithEqualityFn(
    useCanvasStore,
    (state) => collectInputMediaByKind(nodeId, state.nodes, state.edges, mediaKind),
    areMediaOutputListsEqual
  );
  const hasMediaPortConnection = useCanvasStore((state) =>
    state.edges.some((edge) => edge.target === nodeId && edge.targetHandle === mediaHandleId)
  );
  const upstreamUrls = useMemo(() => upstreamMedia.map((item) => item.url), [upstreamMedia]);
  // 本地上传的图片在上传时已经生成过 previewImageUrl（见 prepareNodeImageFromFile），
  // 这里缓存下来供缩略图复用，避免 28px 小图也去解码原图。仅运行时内存缓存，不参与持久化。
  const localPreviewMapRef = useRef(new Map<string, string>());
  const previewUrlByUrl = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of upstreamMedia) {
      if (item.previewUrl) {
        map.set(item.url, item.previewUrl);
      }
    }
    for (const [url, previewUrl] of localPreviewMapRef.current) {
      if (!map.has(url)) {
        map.set(url, previewUrl);
      }
    }
    return map;
  }, [upstreamMedia]);
  const isConnected = hasMediaPortConnection || upstreamUrls.length > 0;
  const displayUrls = isConnected ? upstreamUrls : inlineValue;
  const canAddMore = !isConnected && displayUrls.length < maxCount;
  const socketColor = getSocketColor(mediaKind.toUpperCase());
  const Icon = MEDIA_ICON[mediaKind];

  const handleReorder = useCallback((from: number, to: number) => {
    if (isConnected || from === to) {
      return;
    }
    onInlineChange(moveArrayItem(inlineValue, from, to));
  }, [inlineValue, isConnected, onInlineChange]);

  const { dragState, itemRefs, handleMouseDown } = useReorderDrag({
    disabled: isConnected,
    isCustomDragging: false,
    files: displayUrls,
    onReorder: handleReorder,
  });
  const isRowDragging = dragState.isDragging || dragState.isDropping;

  // 横向让位步进量：拖拽刚开始（toIndex 尚未偏离 fromIndex）时测量一次真实间距，当成固定网格用，
  // 避免用固定像素数（图片/视频/音频 chip 宽度不一致）。
  // 用 offsetLeft（布局坐标，不受画布缩放影响）而不是 getBoundingClientRect()（屏幕坐标，
  // 需要再除一次 zoom 才能换算回本地像素）——这样测出来的步进量可以直接拿来当 translateX 用，
  // 不会因为屏幕坐标换算引入的舍入误差导致"回到原位"和真正原位有一点点偏差。
  const stepPxRef = useRef(34);
  useEffect(() => {
    if (!dragState.isDragging || dragState.fromIndex !== dragState.toIndex) {
      return;
    }
    const first = itemRefs.current[0];
    const second = itemRefs.current[1];
    if (!first || !second) {
      return;
    }
    const measured = Math.abs(second.offsetLeft - first.offsetLeft);
    if (measured > 0) {
      stepPxRef.current = measured;
    }
  }, [dragState.isDragging, dragState.fromIndex, dragState.toIndex, itemRefs]);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0 || isConnected) {
      return;
    }
    const remaining = Math.max(0, maxCount - inlineValue.length);
    const accepted = Array.from(files).slice(0, remaining);
    const uploaded = await Promise.all(accepted.map((file) => fileToMediaUrl(file, mediaKind)));
    for (const item of uploaded) {
      if (item.previewUrl) {
        localPreviewMapRef.current.set(item.url, item.previewUrl);
      }
    }
    const urls = uploaded.map((item) => item.url);
    if (urls.length > 0) {
      onInlineChange([...inlineValue, ...urls]);
    }
  }, [inlineValue, isConnected, maxCount, mediaKind, onInlineChange]);

  const handleRemove = useCallback((index: number) => {
    if (isConnected) {
      return;
    }
    onInlineChange(inlineValue.filter((_, itemIndex) => itemIndex !== index));
  }, [inlineValue, isConnected, onInlineChange]);

  return (
    <div
      className={`${NODE_ROW_CLASS} ${
        isConnected ? '' : NODE_ROW_HOVER_CLASS
      }`}
      style={isRowDragging ? { zIndex: 40 } : undefined}
      onDragOver={(event) => {
        const payload = readAssetDragPayload(event.dataTransfer);
        if (!isConnected && payload?.type === mediaKind && canAddMore) {
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={(event) => {
        const payload = readAssetDragPayload(event.dataTransfer);
        if (!isConnected && payload?.type === mediaKind && canAddMore) {
          event.preventDefault();
          event.stopPropagation();
          onInlineChange([...inlineValue, payload.filePath]);
        }
      }}
    >
      <Handle
        type="target"
        id={mediaHandleId}
        position={Position.Left}
        style={{ background: socketColor, left: 0, top: '50%', transform: 'translate(-50%, -50%)' }}
        className={`${NODE_PORT_ROW_CLASS} ${isConnected ? NODE_PORT_VISIBLE_CLASS : ''}`}
      />
      <span className={NODE_ROW_LABEL_CLASS}>{label}</span>
      <div
        className={`nodrag nowheel gap-1.5 ${NODE_ROW_CONTROL_SLOT_CLASS} ${
          isRowDragging ? 'overflow-visible' : 'overflow-x-auto'
        }`}
      >
        {displayUrls.map((url, index) => {
          const { fromIndex, toIndex } = dragState;
          const isDraggingThis = dragState.isDragging && fromIndex === index;
          const isDroppingThis = dragState.isDropping && fromIndex === index;
          const isDropTarget =
            (dragState.isDragging || dragState.isDropping) && toIndex === index && fromIndex !== index;

          const zoom = dragZoomRef.current;
          let itemStyle: CSSProperties | undefined;
          if (isDraggingThis) {
            // 视觉上任意方向跟随光标（拿起来的手感），排序判定本身只看横向距离，与视觉位移无关
            // 除以 zoom：节点本身处在画布缩放坐标系里，本地 transform 像素会被画布再缩放一次
            itemStyle = {
              transform: `translate(${(dragState.currentX - dragState.startX) / zoom}px, ${
                (dragState.currentY - dragState.startY) / zoom
              }px) scale(1.1)`,
              position: 'relative',
              zIndex: 50,
              opacity: 0.85,
              pointerEvents: 'none',
            };
          } else if (isDroppingThis && fromIndex !== null && toIndex !== null) {
            // 落位动画：直接过渡到重排后的目标列位置，避免先弹回原位再跳到新位的二次跳动
            // 步进量是按布局坐标量出来的固定网格，本地 transform 直接用，不需要再除 zoom
            itemStyle = {
              transform: `translateX(${(toIndex - fromIndex) * stepPxRef.current}px)`,
              transition: uiTransition(['transform'], UI_DURATION.fast),
              position: 'relative',
              zIndex: 50,
            };
          } else if ((dragState.isDragging || dragState.isDropping) && fromIndex !== null && toIndex !== null) {
            // 让位/复位动画：始终显式给出位移值（哪怕是 0）并保留 transition，
            // 这样从"已让位"回到"未让位"也会平滑过渡，而不是直接消失瞬间归位
            let shiftX = 0;
            if (fromIndex < toIndex && index > fromIndex && index <= toIndex) {
              shiftX = -stepPxRef.current;
            } else if (fromIndex > toIndex && index < fromIndex && index >= toIndex) {
              shiftX = stepPxRef.current;
            }
            itemStyle = { transform: `translateX(${shiftX}px)`, transition: uiTransition(['transform'], UI_DURATION.fast) };
          }

          return (
          <div
            key={`${url}-${index}`}
            ref={(element) => {
              itemRefs.current[index] = element;
            }}
            className={`group relative shrink-0 ${isDropTarget ? 'rounded-md ring-2 ring-accent' : ''}`}
            style={itemStyle}
            onMouseDown={
              !isConnected
                ? (event) => {
                    dragZoomRef.current = getZoom();
                    handleMouseDown(index, event);
                  }
                : undefined
            }
          >
            {mediaKind === 'image' ? (
              <CanvasNodeImage
                src={resolveImageDisplayUrl(previewUrlByUrl.get(url) ?? url)}
                viewerSourceUrl={resolveImageDisplayUrl(url)}
                viewerImageList={displayUrls.map((item) => resolveImageDisplayUrl(item))}
                alt=""
                className="h-7 w-7 rounded-md border border-veil-soft object-cover"
                draggable={false}
              />
            ) : mediaKind === 'video' ? (
              <span
                className="flex h-7 cursor-pointer items-center gap-1 rounded-md border border-veil-soft bg-bg-dark/60 px-1.5 text-3xs text-text-muted"
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  setViewerVideoUrl(resolveImageDisplayUrl(url));
                }}
              >
                <Icon className="h-3 w-3 shrink-0" />
                {resolveFileName(url)}
              </span>
            ) : (
              <span className="flex h-7 items-center gap-1 rounded-md border border-veil-soft bg-bg-dark/60 px-1.5 text-3xs text-text-muted">
                <Icon className="h-3 w-3 shrink-0" />
                {resolveFileName(url)}
              </span>
            )}
            {!isConnected && mediaKind === 'video' && videoTrimMaxClipSeconds && (
              <UiIconButton
                onClick={(event) => {
                  event.stopPropagation();
                  setTrimTargetIndex(index);
                }}
                title={t('node.mediaRow.videoTrim')}
                className="absolute -left-1.5 -top-1.5 h-4 w-4 border-0 bg-bg-dark/90 p-0.5 text-text-dark opacity-0 shadow transition-opacity group-hover:opacity-100"
                type="button"
              >
                <Scissors className="h-2.5 w-2.5" />
              </UiIconButton>
            )}
            {!isConnected && (
              <UiIconButton
                onClick={(event) => {
                  event.stopPropagation();
                  handleRemove(index);
                }}
                className="absolute -right-1.5 -top-1.5 h-4 w-4 border-0 bg-red-500 p-0.5 text-white opacity-0 shadow transition-opacity group-hover:opacity-100"
                type="button"
              >
                <X className="h-2.5 w-2.5" />
              </UiIconButton>
            )}
          </div>
          );
        })}
        {canAddMore && (
          <UiIconButton
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              inputRef.current?.click();
            }}
            title={t('node.mediaRow.upload')}
            showBorder
            className="!h-7 !w-7 shrink-0 !rounded-md !border-dashed hover:!border-accent hover:!text-accent"
          >
            <Icon className="h-3.5 w-3.5" />
          </UiIconButton>
        )}
      </div>
      <UiInput
        ref={inputRef}
        type="file"
        accept={MEDIA_ACCEPT[mediaKind]}
        multiple
        className="hidden"
        onChange={(event) => {
          void handleFiles(event.target.files);
          event.target.value = '';
        }}
      />
      {viewerVideoUrl && (
        <VideoViewerModal
          open
          videoUrl={viewerVideoUrl}
          onClose={() => setViewerVideoUrl(null)}
        />
      )}
      {trimTargetIndex !== null && videoTrimMaxClipSeconds && (
        <VideoTrimModal
          open
          previewUrl={resolveImageDisplayUrl(inlineValue[trimTargetIndex])}
          maxClipSeconds={videoTrimMaxClipSeconds}
          maxSizeMB={videoTrimMaxSizeMB}
          resolveSource={async () => inlineValue[trimTargetIndex]}
          initialRange={videoTrimRange ?? null}
          onConfirm={(range) => onVideoTrimRangeChange?.(range)}
          onVideoCompressed={(newPath) => {
            // 完整视频被压缩成新文件：更新画布媒体行引用，后续生成直接用压缩版本
            const idx = trimTargetIndex;
            onInlineChange(inlineValue.map((item, i) => (i === idx ? newPath : item)));
          }}
          onClose={() => setTrimTargetIndex(null)}
        />
      )}
    </div>
  );
}
