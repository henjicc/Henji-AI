import { memo, useMemo } from 'react';
import { useViewport } from '@xyflow/react';
import { ImagePlus, SquareArrowOutUpRight } from 'lucide-react';
import type { StoryboardExportOptions, StoryboardFrameItem } from '@/features/canvas/domain/canvasNodes';
import { resolveImageDisplayUrl, shouldUseOriginalImageByZoom } from '@/features/canvas/application/imageData';
import { CanvasNodeImage } from '@/features/canvas/ui/CanvasNodeImage';
import { ReferenceTextarea, type ReferenceItem } from '@/components/ui';
import { useCanvasStore } from '@/stores/canvasStore';

interface FrameCardProps {
  nodeId: string;
  frame: StoryboardFrameItem;
  index: number;
  frameAspectRatioCss: string;
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
  frameAspectRatioCss,
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
      className={`nodrag relative bg-bg-dark/85 transition-colors ${dragging
        ? 'z-10 opacity-55 ring-1 ring-accent/65'
        : asDropTarget
          ? 'z-10 ring-1 ring-emerald-400/70'
          : ''
        }`}
    >
      <div
        className={`group/frame relative overflow-hidden bg-surface-dark ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        style={{ aspectRatio: frameAspectRatioCss }}
        onPointerDown={(event) => {
          if (event.button !== 0) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          onSortStart(frame.id);
        }}
      >
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

        <button
          type="button"
          className="absolute right-1 top-1 rounded bg-black/60 p-1 text-white opacity-0 transition-all duration-150 hover:bg-black/75 group-hover/frame:opacity-100"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onEditFrame(frame);
          }}
          title="单独编辑此格"
        >
          <SquareArrowOutUpRight className="h-3 w-3" />
        </button>

        <button
          type="button"
          className="absolute bottom-1 right-1 rounded bg-black/60 p-1 text-white opacity-0 transition-all duration-150 hover:bg-black/75 group-hover/frame:opacity-100"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onTogglePicker(frame.id, event.clientX, event.clientY);
          }}
          title="从输入图片替换"
        >
          <ImagePlus className="h-3 w-3" />
        </button>
      </div>

      <ReferenceTextarea
        value={frame.note}
        onChange={(nextValue) => {
          updateStoryboardFrame(nodeId, frame.id, {
            note: nextValue,
          });
        }}
        references={referenceItems}
        pickerAnchorScale={zoom}
        onMouseDown={(event) => event.stopPropagation()}
        onWheelCapture={(event) => event.stopPropagation()}
        placeholder={`分镜 ${String(index + 1).padStart(2, '0')} 描述`}
        className="relative h-10 w-full border-t border-[rgba(255,255,255,0.12)] bg-bg-dark/90"
        highlightLayerClassName="text-[10px] text-text-dark"
        highlightContentClassName="px-2 py-1"
        textareaClassName="ui-scrollbar nodrag nowheel relative z-10 h-10 w-full resize-none overflow-y-auto border-0 bg-transparent px-2 py-1 text-[10px] text-transparent caret-text-dark outline-none focus:border-accent"
        pickerClassName="w-[120px]"
        pickerListClassName="max-h-[180px]"
      />
    </div>
  );
});

FrameCard.displayName = 'FrameCard';
