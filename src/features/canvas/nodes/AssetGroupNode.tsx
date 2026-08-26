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
  // 两条点击路径（点封面走 React Flow 原生选中、点标题走 NodeHeader 命中层）现在都落到
  // 原生 selected 上，所以 selected 已经够用；这里再并上业务 selectedNodeId，是为了兜住
  // useCanvasNodeFocus 那条路径——焦点进入节点内的 nodrag 控件时只会更新 selectedNodeId，
  // 原生 selected 不动。本节点目前没有这类控件，属于防御性的一层，别的节点都只看 selected。
  const isSelectedById = useCanvasStore((state) => state.selectedNodeId === id);
  const isActive = Boolean(selected) || isSelectedById;
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
      <div
        className={`asset-group-node-stack relative flex h-full flex-col overflow-hidden rounded-[var(--node-radius)] border bg-surface-dark ${
          isActive ? NODE_SELECTED_BORDER_CLASS : NODE_IDLE_BORDER_STATIC_CLASS
        }`}
        onDoubleClick={(event) => {
          event.stopPropagation();
          canvasEventBus.publish('asset-group/open', { groupId: id });
        }}
      >
        <div className="shrink-0 border-b border-veil-subtle px-2.5 py-1">
          <NodeHeader
            icon={<ICON_NODE_ASSET_GROUP className="h-3.5 w-3.5" />}
            titleText={title}
            headerAdjust={{ x: 0, y: 0, scale: 1 }}
            rightSlotAdjust={{ x: 0, y: 0, scale: 1 }}
            // NodeHeader 外层行是 items-start：图标+标题这侧的自然高度（由文字行高撑出）
            // 和右侧展开按钮的固定高度不一致时，两侧顶部对齐反而显得没对齐。这里把
            // 图标+标题行钉成和按钮相同的高度，两侧等高后自然垂直居中对齐。
            titleRowClassName="h-6"
            editable
            onTitleChange={(displayName) => updateNodeData(id, { displayName })}
            rightSlot={(
              <UiIconButton
                appearance="hover-only"
                showBorder={false}
                className="nodrag nopan h-6 w-6"
                aria-label={t('canvas.assetGroup.manager.open')}
                title={t('canvas.assetGroup.manager.open')}
                onClick={(event) => {
                  event.stopPropagation();
                  canvasEventBus.publish('asset-group/open', { groupId: id });
                }}
              >
                <Maximize2 className="h-3 w-3" />
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
        className={`${NODE_PORT_NODE_CLASS} ${isActive || data.bindings.length > 0 ? NODE_PORT_VISIBLE_CLASS : ''}`}
        style={{ background: getSocketColor('*'), right: 0, top: '50%', transform: 'translate(50%, -50%)' }}
      />
      <NodeResizeHandle minWidth={220} minHeight={144} maxWidth={2200} maxHeight={1600} />
    </div>
  );
});

AssetGroupNode.displayName = 'AssetGroupNode';
