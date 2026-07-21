import { memo, useCallback, useMemo, type CSSProperties } from 'react';
import { useViewport } from '@xyflow/react';
import { ImagePlus, SquareArrowOutUpRight } from 'lucide-react';
import type { StoryboardExportOptions, StoryboardFrameItem } from '@/features/canvas/domain/canvasNodes';
import { resolveImageDisplayUrl, shouldUseOriginalImageByZoom } from '@/features/canvas/application/imageData';
import { CanvasNodeImage } from '@/features/canvas/ui/CanvasNodeImage';
import { ReferenceTextarea, type ReferenceItem, UiIconButton } from '@/components/ui';
import { useCanvasStore } from '@/stores/canvasStore';
import { createCanvasTextHistoryGroup, useCanvasTextHistory } from '@/features/canvas/hooks/useCanvasTextHistory';

interface FrameCardProps {
  nodeId: string;
  frame: StoryboardFrameItem;
  index: number;
  noteFontSizePx: number;
  noteLineHeightPx: number;
  noteHeightPx: number;
  imageFit: StoryboardExportOptions['imageFit'];
  viewerImageList: string[];
  referenceItems: ReferenceItem[];
  draggedFrameId: string | null;
  dropTargetFrameId: string | null;
  onSortStart: (frameId: string) => void;
  onSortHover: (frameId: string) => void;
  onTogglePicker: (frameId: string, x: number, y: number) => void;
  onEditFrame: (frame: StoryboardFrameItem) => void;
}

export const FrameCard = memo(({
  nodeId,
  frame,
  index,
  noteFontSizePx,
  noteLineHeightPx,
  noteHeightPx,
  imageFit,
  viewerImageList,
  referenceItems,
  draggedFrameId,
  dropTargetFrameId,
  onSortStart,
  onSortHover,
  onTogglePicker,
  onEditFrame,
}: FrameCardProps): JSX.Element => {
  const updateStoryboardFrame = useCanvasStore((state) => state.updateStoryboardFrame);
  const { zoom } = useViewport();
  const noteHistoryGroup = createCanvasTextHistoryGroup(nodeId, `frames.${frame.id}.note`);
  const handleNoteChange = useCallback((nextValue: string): void => {
    updateStoryboardFrame(nodeId, frame.id, { note: nextValue }, { historyGroup: noteHistoryGroup });
  }, [frame.id, nodeId, noteHistoryGroup, updateStoryboardFrame]);
  const noteTextHistory = useCanvasTextHistory(noteHistoryGroup, handleNoteChange);

  const imageSource = useMemo(() => {
    const preferOriginal = shouldUseOriginalImageByZoom(zoom);
    const picked = preferOriginal
      ? frame.imageUrl || frame.previewImageUrl
      : frame.previewImageUrl || frame.imageUrl;
    return picked ? resolveImageDisplayUrl(picked) : null;
  }, [frame.imageUrl, frame.previewImageUrl, zoom]);

  const viewerSource = useMemo(() => {
    const picked = frame.imageUrl || frame.previewImageUrl;
    return picked ? resolveImageDisplayUrl(picked) : null;
  }, [frame.imageUrl, frame.previewImageUrl]);

  const dragging = draggedFrameId === frame.id;
  const asDropTarget = dropTargetFrameId === frame.id && !dragging;

  const noteWrapperStyle = {
    height: `${noteHeightPx}px`,
    '--storyboard-note-font-size': `${noteFontSizePx}px`,
    '--storyboard-note-line-height': `${noteLineHeightPx}px`,
  } as CSSProperties;

  return (
    <div
      onPointerEnter={(event) => {
        event.stopPropagation();
        onSortHover(frame.id);
      }}
      onPointerMove={(event) => {
        event.stopPropagation();
        onSortHover(frame.id);
      }}
      onMouseDown={(event) => event.stopPropagation()}
      className={`group/frame nodrag relative h-full w-full overflow-hidden bg-surface-dark transition-colors ${dragging ? 'cursor-grabbing' : 'cursor-grab'} ${dragging
        ? 'z-10 opacity-55 ring-1 ring-accent/65'
        : asDropTarget
          ? 'z-10 ring-1 ring-emerald-400/70'
          : ''
        }`}
      onPointerDown={(event) => {
        if (event.button !== 0) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        onSortStart(frame.id);
      }}
    >
      <div className="relative h-full w-full">
        {frame.imageUrl ? (
          <CanvasNodeImage
            src={imageSource ?? ''}
            alt={`Frame ${index + 1}`}
            viewerSourceUrl={viewerSource}
            viewerImageList={viewerImageList}
            className={`h-full w-full ${imageFit === 'contain' ? 'object-contain' : 'object-cover'}`}
            draggable={false}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[11px] text-text-muted">
            空分镜
          </div>
        )}

        <div className="absolute right-1 top-1 flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover/frame:opacity-100">
          <UiIconButton
            type="button"
            className="!h-6 !w-6 rounded bg-black/60 p-1 text-white hover:bg-black/75"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onTogglePicker(frame.id, event.clientX, event.clientY);
            }}
            title="从输入图片替换"
          >
            <ImagePlus className="h-3 w-3" />
          </UiIconButton>

          <UiIconButton
            type="button"
            className="!h-6 !w-6 rounded bg-black/60 p-1 text-white hover:bg-black/75"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onEditFrame(frame);
            }}
            title="单独编辑此格"
          >
            <SquareArrowOutUpRight className="h-3 w-3" />
          </UiIconButton>
        </div>

        <div
          className="nodrag absolute inset-x-0 bottom-0 z-[5] overflow-hidden bg-gradient-to-t from-black/80 via-black/45 to-transparent"
          style={noteWrapperStyle}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <ReferenceTextarea
            value={frame.note}
            onChange={noteTextHistory.onValueChange}
            textHistorySession={noteTextHistory}
            references={referenceItems}
            pickerAnchorScale={zoom}
            onMouseDown={(event) => event.stopPropagation()}
            onWheelCapture={(event) => event.stopPropagation()}
            placeholder={`分镜 ${String(index + 1).padStart(2, '0')} 描述`}
            wrap="soft"
            className="relative h-full w-full"
            highlightLayerClassName="text-[length:var(--storyboard-note-font-size)] leading-[var(--storyboard-note-line-height)] text-white"
            highlightContentClassName="px-2 py-1 text-left"
            textareaClassName="ui-scrollbar nodrag nowheel relative z-10 block h-full w-full resize-none overflow-y-auto border-0 bg-transparent px-2 py-1 text-left text-[length:var(--storyboard-note-font-size)] leading-[var(--storyboard-note-line-height)] text-transparent caret-white outline-none placeholder:text-white/45 whitespace-pre-wrap break-words"
            pickerClassName="w-[120px]"
            pickerListClassName="max-h-[180px]"
          />
        </div>
      </div>
    </div>
  );
});

FrameCard.displayName = 'FrameCard';
