import { memo, useMemo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Maximize2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { UiIconButton } from '@/components/ui';
import {
  ICON_MEDIA_AUDIO,
  ICON_MEDIA_IMAGE,
  ICON_MEDIA_VIDEO,
  ICON_NODE_ASSET_GROUP,
} from '@/core/theme/icons';
import { canvasEventBus } from '@/features/canvas/application/canvasServices';
import {
  CANVAS_NODE_TYPES,
  type AssetGroupNodeData,
} from '@/features/canvas/domain/canvasNodes';
import { getNodeMediaOutputs } from '@/features/canvas/domain/nodeRegistry';
import { resolveAssetGroupMemberKind } from '@/features/canvas/application/assetGroupGraph';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { useCanvasStore } from '@/stores/canvasStore';
import { NodeHeader } from '@/features/canvas/ui/NodeHeader';
import {
  NODE_IDLE_BORDER_STATIC_CLASS,
  NODE_PORT_NODE_CLASS,
  NODE_SELECTED_BORDER_CLASS,
} from '@/features/canvas/ui/nodeControlStyles';

interface AssetGroupNodeProps {
  id: string;
  data: AssetGroupNodeData;
  selected?: boolean;
}

export const AssetGroupNode = memo(({ id, data, selected }: AssetGroupNodeProps) => {
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const members = useCanvasStore(useShallow((state) => state.nodes.filter((node) => node.parentId === id)));
  const title = useMemo(() => resolveNodeDisplayName(CANVAS_NODE_TYPES.assetGroup, data), [data]);
  const mediaSummary = useMemo(() => {
    const counts = { image: 0, video: 0, audio: 0 };
    for (const member of members) {
      const kind = resolveAssetGroupMemberKind(member);
      if (kind === 'image' || kind === 'video' || kind === 'audio') counts[kind] += 1;
    }
    return counts;
  }, [members]);
  const coverNode = members.find((member) => member.id === data.coverMemberId) ?? members[0];
  const cover = coverNode ? getNodeMediaOutputs(coverNode.type, coverNode.data)[0] : undefined;

  return (
    <div className="group relative h-full min-h-36 w-full min-w-56 overflow-visible">
      <div className={`asset-group-node-stack relative h-full overflow-hidden rounded-[var(--node-radius)] border bg-surface-dark ${
        selected ? NODE_SELECTED_BORDER_CLASS : NODE_IDLE_BORDER_STATIC_CLASS
      }`}>
        <NodeHeader
          icon={<ICON_NODE_ASSET_GROUP className="h-4 w-4" />}
          titleText={title}
          editable
          onTitleChange={(displayName) => updateNodeData(id, { displayName })}
          rightSlot={(
            <UiIconButton
              appearance="hover-only"
              showBorder={false}
              className="nodrag nopan h-7 w-7"
              aria-label="展开素材组"
              title="展开素材组"
              onClick={(event) => {
                event.stopPropagation();
                canvasEventBus.publish('asset-group/open', { groupId: id });
              }}
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </UiIconButton>
          )}
        />
        <div className="relative h-24 overflow-hidden bg-app">
          {cover?.kind === 'image' && (
            <img src={cover.previewUrl ?? cover.url} alt="" className="h-full w-full object-cover" draggable={false} />
          )}
          {cover?.kind === 'video' && cover.previewUrl && (
            <img src={cover.previewUrl} alt="" className="h-full w-full object-cover" draggable={false} />
          )}
          {!cover && (
            <div className="flex h-full items-center justify-center text-text-faint">
              <ICON_NODE_ASSET_GROUP className="h-8 w-8" />
            </div>
          )}
          <div className="ui-glass absolute bottom-2 left-2 flex items-center gap-2 rounded-lg px-2 py-1 text-2xs text-text-dark">
            <span className="flex items-center gap-1"><ICON_MEDIA_IMAGE className="h-3 w-3" />{mediaSummary.image}</span>
            <span className="flex items-center gap-1"><ICON_MEDIA_VIDEO className="h-3 w-3" />{mediaSummary.video}</span>
            <span className="flex items-center gap-1"><ICON_MEDIA_AUDIO className="h-3 w-3" />{mediaSummary.audio}</span>
          </div>
        </div>
      </div>
      <Handle
        type="source"
        id="source"
        position={Position.Right}
        className={NODE_PORT_NODE_CLASS}
        style={{ right: -4, top: '50%' }}
      />
    </div>
  );
});

AssetGroupNode.displayName = 'AssetGroupNode';
