import { useCallback, useRef, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { useStoreWithEqualityFn } from 'zustand/traditional';
import { Image as ImageIcon, Music, Video, X } from 'lucide-react';

import { prepareNodeImageFromFile, resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import {
  areStringListsEqual,
  collectInputMediaUrls,
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
import { useReorderDrag } from '@/components/ui/fileUploader/useReorderDrag';

interface MediaInputRowProps {
  nodeId: string;
  mediaKind: RowMediaKind;
  label: string;
  maxCount: number;
  inlineValue: string[];
  onInlineChange: (next: string[]) => void;
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

async function fileToMediaUrl(file: File, kind: RowMediaKind): Promise<string> {
  if (kind === 'image') {
    const prepared = await prepareNodeImageFromFile(file);
    return prepared.imageUrl;
  }
  if (kind === 'video') {
    const saved = await saveUploadVideo(file, 'persist');
    return saved.fullPath;
  }
  const saved = await saveUploadAudio(file, 'persist');
  return saved.fullPath;
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
}: MediaInputRowProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [viewerVideoUrl, setViewerVideoUrl] = useState<string | null>(null);

  const upstreamUrls = useStoreWithEqualityFn(
    useCanvasStore,
    (state) => collectInputMediaUrls(nodeId, state.nodes, state.edges, mediaKind),
    areStringListsEqual
  );
  const isConnected = upstreamUrls.length > 0;
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

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0 || isConnected) {
      return;
    }
    const remaining = Math.max(0, maxCount - inlineValue.length);
    const accepted = Array.from(files).slice(0, remaining);
    const urls = await Promise.all(accepted.map((file) => fileToMediaUrl(file, mediaKind)));
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
    >
      <Handle
        type="target"
        id={mediaPortId(mediaKind)}
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
          const isDraggingThis = dragState.isDragging && dragState.fromIndex === index;
          const isDroppingThis = dragState.isDropping && dragState.fromIndex === index;
          const isDropTarget =
            (dragState.isDragging || dragState.isDropping) &&
            dragState.toIndex === index &&
            dragState.fromIndex !== index;

          return (
          <div
            key={`${url}-${index}`}
            ref={(element) => {
              itemRefs.current[index] = element;
            }}
            className={`group relative shrink-0 ${isDropTarget ? 'rounded-md ring-2 ring-accent' : ''}`}
            style={
              isDraggingThis
                ? {
                    // 仅水平方向跟随光标：排序判定本身就只看横向距离，纵向位移只会带来抖动/触发行内滚动条
                    transform: `translateX(${dragState.currentX - dragState.startX}px) scale(1.1)`,
                    position: 'relative',
                    zIndex: 50,
                    opacity: 0.85,
                    pointerEvents: 'none',
                  }
                : isDroppingThis
                  ? { transform: 'translateX(0px)', transition: 'transform 0.15s ease', position: 'relative', zIndex: 50 }
                  : undefined
            }
            onMouseDown={!isConnected ? (event) => handleMouseDown(index, event) : undefined}
          >
            {mediaKind === 'image' ? (
              <CanvasNodeImage
                src={resolveImageDisplayUrl(url)}
                viewerImageList={displayUrls.map((item) => resolveImageDisplayUrl(item))}
                alt=""
                className="h-7 w-7 rounded-md border border-[rgba(255,255,255,0.18)] object-cover"
                draggable={false}
              />
            ) : mediaKind === 'video' ? (
              <span
                className="flex h-7 cursor-pointer items-center gap-1 rounded-md border border-[rgba(255,255,255,0.18)] bg-bg-dark/60 px-1.5 text-[10px] text-text-muted"
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  setViewerVideoUrl(resolveImageDisplayUrl(url));
                }}
              >
                <Icon className="h-3 w-3 shrink-0" />
                {resolveFileName(url)}
              </span>
            ) : (
              <span className="flex h-7 items-center gap-1 rounded-md border border-[rgba(255,255,255,0.18)] bg-bg-dark/60 px-1.5 text-[10px] text-text-muted">
                <Icon className="h-3 w-3 shrink-0" />
                {resolveFileName(url)}
              </span>
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
    </div>
  );
}
