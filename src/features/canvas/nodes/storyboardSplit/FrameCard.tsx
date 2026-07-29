import { memo, useCallback, useEffect, useMemo, type CSSProperties } from 'react';
import { ImagePlus, SquareArrowOutUpRight } from 'lucide-react';
import type { StoryboardExportOptions, StoryboardFrameItem } from '@/features/canvas/domain/canvasNodes';
import type { PromptDocumentV1 } from '@/core/inputs/promptDocument';
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import { CanvasNodeImage } from '@/features/canvas/ui/CanvasNodeImage';
import { type PromptReferenceItem, UiIconButton } from '@/components/ui';
import { useCanvasStore } from '@/stores/canvasStore';
import { createCanvasTextHistoryGroup, useCanvasEditHistory } from '@/features/canvas/hooks/useCanvasTextHistory';
import { CanvasPromptEditor } from '@/features/canvas/nodes/shared/CanvasPromptEditor';
import {
  resolveStoryboardPromptDocument,
  storyboardPromptDocumentsEqual,
} from '@/features/canvas/application/storyboardPromptDocument';
import { useOriginalImageLod } from '@/features/canvas/nodes/shared/useOriginalImageLod';

interface FrameCardProps {
  nodeId: string;
  selected: boolean;
  frame: StoryboardFrameItem;
  index: number;
  noteFontSizePx: number;
  noteLineHeightPx: number;
  noteHeightPx: number;
  imageFit: StoryboardExportOptions['imageFit'];
  viewerImageList: string[];
  referenceItems: readonly PromptReferenceItem[];
  draggedFrameId: string | null;
  dropTargetFrameId: string | null;
  onSortStart: (frameId: string) => void;
  onSortHover: (frameId: string) => void;
  onTogglePicker: (frameId: string, x: number, y: number) => void;
  onEditFrame: (frame: StoryboardFrameItem) => void;
  onSelectNode: () => void;
}

export const FrameCard = memo(({
  nodeId,
  selected,
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
  onSelectNode,
}: FrameCardProps): JSX.Element => {
  const updateStoryboardFrame = useCanvasStore((state) => state.updateStoryboardFrame);
  const preferOriginalImage = useOriginalImageLod();
  const noteHistoryGroup = createCanvasTextHistoryGroup(nodeId, `frames.${frame.id}.note`);
  const editHistory = useCanvasEditHistory(noteHistoryGroup);
  const resolvedNote = useMemo(() => resolveStoryboardPromptDocument({
    document: frame.noteDocument,
    legacyText: frame.note ?? '',
    carrierType: 'storyboard-split-note',
    carrierId: `${nodeId}:${frame.id}`,
    references: referenceItems,
  }), [frame.id, frame.note, frame.noteDocument, nodeId, referenceItems]);

  useEffect(() => {
    if (
      frame.note === resolvedNote.legacyText
      && storyboardPromptDocumentsEqual(frame.noteDocument, resolvedNote.document)
    ) return;
    updateStoryboardFrame(nodeId, frame.id, {
      noteDocument: resolvedNote.document,
      note: resolvedNote.legacyText,
    }, { skipHistory: true });
  }, [frame.id, frame.note, frame.noteDocument, nodeId, resolvedNote, updateStoryboardFrame]);

  const handleNoteChange = useCallback((document: PromptDocumentV1): void => {
    const resolved = resolveStoryboardPromptDocument({
      document,
      legacyText: frame.note ?? '',
      carrierType: 'storyboard-split-note',
      carrierId: `${nodeId}:${frame.id}`,
      references: referenceItems,
    });
    updateStoryboardFrame(nodeId, frame.id, {
      noteDocument: resolved.document,
      note: resolved.legacyText,
    }, { historyGroup: noteHistoryGroup });
  }, [frame.id, frame.note, nodeId, noteHistoryGroup, referenceItems, updateStoryboardFrame]);

  const imageSource = useMemo(() => {
    const picked = preferOriginalImage
      ? frame.imageUrl || frame.previewImageUrl
      : frame.previewImageUrl || frame.imageUrl;
    return picked ? resolveImageDisplayUrl(picked) : null;
  }, [frame.imageUrl, frame.previewImageUrl, preferOriginalImage]);

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
      className={`storyboard-frame-card group/frame nodrag relative h-full w-full overflow-hidden bg-surface-dark transition-colors ${dragging ? 'cursor-grabbing' : 'cursor-grab'} ${dragging
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
          <div className="flex h-full w-full items-center justify-center text-2xs text-text-muted">
            空分镜
          </div>
        )}

        <div className="storyboard-frame-actions absolute right-1 top-1 flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover/frame:opacity-100 group-focus-within/frame:opacity-100">
          <UiIconButton
            type="button"
            appearance="glass"
            className="!h-6 !w-6 !rounded p-1"
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
            appearance="glass"
            className="!h-6 !w-6 !rounded p-1"
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
          className="nodrag absolute inset-x-0 bottom-0 z-raised overflow-hidden bg-gradient-to-t from-black/80 via-black/45 to-transparent"
          style={noteWrapperStyle}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <CanvasPromptEditor
            selected={selected}
            onSelectNode={onSelectNode}
            value={resolvedNote.document}
            onChange={handleNoteChange}
            onEditEnd={editHistory.onEditEnd}
            preset="media-references"
            references={referenceItems}
            ariaLabel={`分镜 ${String(index + 1).padStart(2, '0')} 描述`}
            placeholder={`分镜 ${String(index + 1).padStart(2, '0')} 描述`}
            className="nodrag nowheel relative h-full min-h-0 w-full cursor-text"
            editorShellClassName="relative h-full min-h-0 w-full cursor-text overflow-visible !rounded-none !border-0 !bg-transparent !shadow-none focus-within:!ring-0"
            editorClassName="ui-scrollbar nodrag nowheel h-full min-h-0 overflow-y-auto !px-2 !py-1 text-left !text-[length:var(--storyboard-note-font-size)] !leading-[var(--storyboard-note-line-height)] !text-white"
          />
        </div>
      </div>
    </div>
  );
});

FrameCard.displayName = 'FrameCard';
