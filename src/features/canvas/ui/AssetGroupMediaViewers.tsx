import { useMemo } from 'react';

import { AudioViewerModal } from '@/components/mediaViewer/AudioViewerModal';
import { ImageViewerModal } from '@/components/mediaViewer/ImageViewerModal';
import { VideoViewerModal } from '@/components/mediaViewer/VideoViewerModal';
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import { resolveAssetGroupMemberKind } from '@/features/canvas/application/assetGroupGraph';
import type { CanvasNode } from '@/features/canvas/domain/canvasNodes';
import { getNodeMediaOutputs } from '@/features/canvas/domain/nodeRegistry';

interface AssetGroupMediaViewersProps {
  members: CanvasNode[];
  selectedMemberId: string | null;
  onSelectMember: (memberId: string) => void;
  onClose: () => void;
}

export function AssetGroupMediaViewers({
  members,
  selectedMemberId,
  onSelectMember,
  onClose,
}: AssetGroupMediaViewersProps) {
  const viewerItems = useMemo(() => members.flatMap((member) => {
    const kind = resolveAssetGroupMemberKind(member);
    if (!kind) return [];
    const output = getNodeMediaOutputs(member.type, member.data).find((item) => item.kind === kind);
    if (!output?.url) return [];
    return [{
      memberId: member.id,
      kind,
      source: output.url,
      displaySource: resolveImageDisplayUrl(output.url),
    }];
  }), [members]);
  const selected = viewerItems.find((item) => item.memberId === selectedMemberId) ?? null;
  const images = viewerItems.filter((item) => item.kind === 'image');
  const imageIndex = selected?.kind === 'image'
    ? images.findIndex((item) => item.memberId === selected.memberId)
    : -1;

  return (
    <>
      <ImageViewerModal
        open={selected?.kind === 'image'}
        imageUrl={selected?.kind === 'image' ? selected.displaySource : ''}
        imageList={images.map((item) => item.displaySource)}
        filePaths={images.map((item) => item.source)}
        infoSource={selected?.kind === 'image' ? selected.source : undefined}
        currentIndex={Math.max(0, imageIndex)}
        onClose={onClose}
        onNavigate={(direction) => {
          const nextIndex = direction === 'prev' ? imageIndex - 1 : imageIndex + 1;
          const next = images[nextIndex];
          if (next) onSelectMember(next.memberId);
        }}
      />
      <VideoViewerModal
        open={selected?.kind === 'video'}
        videoUrl={selected?.kind === 'video' ? selected.displaySource : ''}
        filePath={selected?.kind === 'video' ? selected.source : undefined}
        onClose={onClose}
      />
      <AudioViewerModal
        open={selected?.kind === 'audio'}
        audioUrl={selected?.kind === 'audio' ? selected.displaySource : ''}
        filePath={selected?.kind === 'audio' ? selected.source : undefined}
        autoPlay
        onClose={onClose}
      />
    </>
  );
}
