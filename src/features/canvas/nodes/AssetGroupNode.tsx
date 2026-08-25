import { memo, useMemo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Maximize2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
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
import { resolveAssetGroupMemberKind } from '@/features/canvas/application/assetGroupGraph';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { getSocketColor } from '@/features/canvas/domain/socketTypes';
import { useCanvasStore } from '@/stores/canvasStore';
import { NodeHeader } from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import { AssetGroupPreview } from '@/features/canvas/nodes/assetGroup/AssetGroupPreview';
import { resolveAssetGroupPreviewItems } from '@/features/canvas/nodes/assetGroup/assetGroupPreviewModel';
import {
  NODE_IDLE_BORDER_STATIC_CLASS,
  NODE_PORT_NODE_CLASS,
  NODE_PORT_VISIBLE_CLASS,
  NODE_SELECTED_BORDER_CLASS,
} from '@/features/canvas/ui/nodeControlStyles';

interface AssetGroupNodeProps {
  id: string;
  data: AssetGroupNodeData;
  selected?: boolean;
}

export const AssetGroupNode = memo(({ id, data, selected }: AssetGroupNodeProps) => {
  const { t } = useTranslation();
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
  const previewItems = useMemo(
    () => resolveAssetGroupPreviewItems(members, data),
    [data, members],
  );

  return (
    <div className="group relative h-full min-h-36 w-full min-w-[220px] overflow-visible">
      <div className={`asset-group-node-stack relative flex h-full flex-col overflow-hidden rounded-[var(--node-radius)] border bg-surface-dark ${
        selected ? NODE_SELECTED_BORDER_CLASS : NODE_IDLE_BORDER_STATIC_CLASS
      }`}>
        <div className="shrink-0 border-b border-veil-subtle px-3 py-2">
          <NodeHeader
            icon={<ICON_NODE_ASSET_GROUP className="h-4 w-4" />}
            titleText={title}
            headerAdjust={{ x: 0, y: 0, scale: 1 }}
            rightSlotAdjust={{ x: 0, y: 0, scale: 1 }}
            editable
            onTitleChange={(displayName) => updateNodeData(id, { displayName })}
            rightSlot={(
              <UiIconButton
                appearance="hover-only"
                showBorder={false}
                className="nodrag nopan h-7 w-7"
                aria-label={t('canvas.assetGroup.manager.open')}
                title={t('canvas.assetGroup.manager.open')}
                onClick={(event) => {
                  event.stopPropagation();
                  canvasEventBus.publish('asset-group/open', { groupId: id });
                }}
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </UiIconButton>
            )}
          />
        </div>
        <div className="relative min-h-0 flex-1 overflow-hidden bg-app">
          <AssetGroupPreview items={previewItems} />
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
        aria-label={t('canvas.assetGroup.manager.connect')}
        title={t('canvas.assetGroup.manager.connect')}
        className={`${NODE_PORT_NODE_CLASS} ${selected || data.bindings.length > 0 ? NODE_PORT_VISIBLE_CLASS : ''}`}
        style={{ background: getSocketColor('*'), right: 0, top: '50%', transform: 'translate(50%, -50%)' }}
      />
      <NodeResizeHandle minWidth={220} minHeight={144} maxWidth={2200} maxHeight={1600} />
    </div>
  );
});

AssetGroupNode.displayName = 'AssetGroupNode';
