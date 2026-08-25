import { memo } from 'react';
import { ArrowLeft, ArrowRight, GripVertical, LogOut, Star } from 'lucide-react';

import { useReorderDrag } from '@/components/ui/fileUploader/useReorderDrag';
import {
  UI_META_BADGE_CLASS,
  UI_TEXT_LABEL_CLASS,
  UI_TEXT_META_CLASS,
  UiIconButton,
  UiPanel,
} from '@/components/ui';
import { UI_DURATION, uiTransition } from '@/components/ui/motion';
import {
  ICON_MEDIA_AUDIO,
  ICON_MEDIA_IMAGE,
  ICON_MEDIA_VIDEO,
} from '@/core/theme/icons';
import type { RowMediaKind } from '@/features/canvas/domain/socketTypes';
import type { CanvasNode } from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { AssetGroupPreview } from '@/features/canvas/nodes/assetGroup/AssetGroupPreview';
import type { AssetGroupPreviewItem } from '@/features/canvas/nodes/assetGroup/assetGroupPreviewModel';

const MEDIA_ICON = {
  image: ICON_MEDIA_IMAGE,
  video: ICON_MEDIA_VIDEO,
  audio: ICON_MEDIA_AUDIO,
};

interface AssetGroupMemberSectionProps {
  kind: RowMediaKind;
  title: string;
  members: CanvasNode[];
  coverMemberId: string | null;
  previewByMemberId: Map<string, AssetGroupPreviewItem>;
  labels: {
    cover: string;
    setCover: string;
    moveEarlier: string;
    moveLater: string;
    remove: string;
    dragHint: string;
    openViewer: string;
  };
  onReorder: (fromIndex: number, toIndex: number) => void;
  onSetCover: (memberId: string) => void;
  onRemoveRequest: (memberId: string) => void;
  onOpenViewer: (memberId: string) => void;
}

export const AssetGroupMemberSection = memo(({
  kind,
  title,
  members,
  coverMemberId,
  previewByMemberId,
  labels,
  onReorder,
  onSetCover,
  onRemoveRequest,
  onOpenViewer,
}: AssetGroupMemberSectionProps) => {
  const KindIcon = MEDIA_ICON[kind];
  const { dragState, itemRefs, handleMouseDown } = useReorderDrag({
    disabled: members.length < 2,
    isCustomDragging: false,
    files: members.map((member) => member.id),
    layout: 'grid',
    onReorder,
  });

  if (members.length === 0) return null;

  return (
    <section data-asset-group-kind={kind}>
      <div className="mb-2 flex items-center gap-2">
        <KindIcon className="h-4 w-4 text-text-muted" />
        <h3 className={UI_TEXT_LABEL_CLASS}>{title}</h3>
        <span className={UI_TEXT_META_CLASS}>{members.length}</span>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {members.map((member, index) => {
          const isCover = coverMemberId === member.id;
          const preview = previewByMemberId.get(member.id);
          const isDragging = dragState.isDragging && dragState.fromIndex === index;
          const isDropTarget = dragState.isDragging && dragState.toIndex === index && !isDragging;
          return (
            <UiPanel
              key={member.id}
              ref={(element) => { itemRefs.current[index] = element; }}
              variant="inset"
              data-asset-group-manager-member={member.id}
              data-asset-group-member-index={index + 1}
              className={`min-w-0 cursor-grab overflow-hidden active:cursor-grabbing ${isDropTarget ? 'ring-1 ring-inset ring-accent' : ''}`}
              style={{
                opacity: isDragging ? 0.78 : 1,
                transform: isDragging
                  ? `translate(${dragState.currentX - dragState.startX}px, ${dragState.currentY - dragState.startY}px) scale(1.02)`
                  : undefined,
                transition: isDragging ? 'none' : uiTransition(['opacity', 'transform'], UI_DURATION.fast),
                zIndex: isDragging ? 1 : undefined,
              }}
              title={labels.dragHint}
              onMouseDown={(event) => handleMouseDown(index, event)}
            >
              <div
                className="relative aspect-video overflow-hidden bg-app"
                title={labels.openViewer}
                onDoubleClick={() => onOpenViewer(member.id)}
              >
                {preview ? (
                  <AssetGroupPreview items={[preview]} showKindBadge={false} />
                ) : (
                  <div className="flex h-full items-center justify-center text-text-faint">
                    <KindIcon className="h-10 w-10" />
                  </div>
                )}
                <span className={`absolute left-2 top-2 text-2xs ${UI_META_BADGE_CLASS}`}>
                  {index + 1}
                </span>
                {isCover && (
                  <span className="absolute right-2 top-2 flex items-center gap-1 rounded bg-accent/10 px-2 py-0.5 text-2xs text-brand-300">
                    <Star className="h-3 w-3" fill="currentColor" strokeWidth={0} />
                    {labels.cover}
                  </span>
                )}
              </div>
              <div className="flex min-w-0 items-center gap-2 p-3">
                <GripVertical className="h-4 w-4 shrink-0 text-text-faint" aria-hidden="true" />
                <KindIcon className="h-4 w-4 shrink-0 text-text-muted" />
                <span className="min-w-0 flex-1 truncate text-sm text-text-dark">
                  {resolveNodeDisplayName(member.type, member.data)}
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  <UiIconButton
                    appearance="hover-only"
                    showBorder={false}
                    className="h-8 w-8"
                    aria-label={labels.moveEarlier}
                    title={labels.moveEarlier}
                    disabled={index === 0}
                    onClick={() => onReorder(index, index - 1)}
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </UiIconButton>
                  <UiIconButton
                    appearance="hover-only"
                    showBorder={false}
                    className="h-8 w-8"
                    aria-label={labels.moveLater}
                    title={labels.moveLater}
                    disabled={index === members.length - 1}
                    onClick={() => onReorder(index, index + 1)}
                  >
                    <ArrowRight className="h-4 w-4" />
                  </UiIconButton>
                  <UiIconButton
                    appearance="hover-only"
                    showBorder={false}
                    active={isCover}
                    className="h-8 w-8"
                    aria-label={labels.setCover}
                    title={labels.setCover}
                    onClick={() => onSetCover(member.id)}
                  >
                    <Star
                      className="h-4 w-4"
                      fill={isCover ? 'currentColor' : 'none'}
                      strokeWidth={isCover ? 0 : 2}
                    />
                  </UiIconButton>
                  <UiIconButton
                    appearance="hover-only"
                    showBorder={false}
                    hoverVariant="danger"
                    className="h-8 w-8"
                    aria-label={labels.remove}
                    title={labels.remove}
                    onClick={() => onRemoveRequest(member.id)}
                  >
                    <LogOut className="h-4 w-4" />
                  </UiIconButton>
                </div>
              </div>
            </UiPanel>
          );
        })}
      </div>
    </section>
  );
});

AssetGroupMemberSection.displayName = 'AssetGroupMemberSection';
