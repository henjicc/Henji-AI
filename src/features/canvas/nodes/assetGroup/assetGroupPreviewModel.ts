import { resolveAssetGroupMemberKind } from '@/features/canvas/application/assetGroupGraph';
import type {
  AssetGroupNodeData,
  CanvasNode,
} from '@/features/canvas/domain/canvasNodes';
import { getNodeMediaOutputs } from '@/features/canvas/domain/nodeRegistry';

export interface AssetGroupPreviewItem {
  id: string;
  kind: 'image' | 'video';
  /** 原媒体；没有作品自带预览时，显示端按它取缓存缩略图。 */
  source: string | null;
  /** 作品自带的预览（生成结果封面等）。 */
  preview: string | null;
}

function orderedMembers(members: CanvasNode[], data: AssetGroupNodeData): CanvasNode[] {
  const memberById = new Map(members.map((member) => [member.id, member] as const));
  const orderedIds = [
    data.coverMemberId,
    ...data.memberOrder,
    ...members.map((member) => member.id),
  ].filter((id): id is string => Boolean(id));

  return [...new Set(orderedIds)]
    .map((id) => memberById.get(id))
    .filter((member): member is CanvasNode => Boolean(member));
}

/**
 * 素材组折叠态的视觉投影。显示端只画静态图：图片与视频都按原媒体取缓存缩略图，避免折叠组常驻视频解码器。
 */
export function resolveAssetGroupPreviewItems(
  members: CanvasNode[],
  data: AssetGroupNodeData,
): AssetGroupPreviewItem[] {
  return orderedMembers(members, data).flatMap((member) => {
    const kind = resolveAssetGroupMemberKind(member);
    if (kind !== 'image' && kind !== 'video') return [];

    const output = getNodeMediaOutputs(member.type, member.data)
      .find((candidate) => candidate.kind === kind);
    return [{ id: member.id, kind, source: output?.url ?? null, preview: output?.previewUrl ?? null }];
  });
}
