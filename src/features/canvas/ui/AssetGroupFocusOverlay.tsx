import { memo } from 'react';
import { ChevronLeft, ChevronRight, LogOut, RotateCcw, Star, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { UiChipButton, UiIconButton, UiPanel } from '@/components/ui';
import { ICON_NODE_ASSET_GROUP } from '@/core/theme/icons';
import {
  removeAssetGroupMember,
  restoreAssetGroupBinding,
  updateAssetGroup,
} from '@/features/canvas/application/assetGroupApplicationService';
import { summarizeAssetGroupBinding } from '@/features/canvas/application/assetGroupGraph';
import { isAssetGroupNode } from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { useCanvasStore } from '@/stores/canvasStore';

interface AssetGroupFocusOverlayProps {
  groupId: string;
  onClose: () => void;
}

export const AssetGroupFocusOverlay = memo(({ groupId, onClose }: AssetGroupFocusOverlayProps) => {
  const graph = useCanvasStore(useShallow((state) => ({ nodes: state.nodes, edges: state.edges })));
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const node = graph.nodes.find((item) => item.id === groupId);
  if (!node || !isAssetGroupNode(node)) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-panel">
      <div className="ui-glass-scrim ui-glass-scrim-soft absolute inset-0" />
      <UiPanel
        variant="glass"
        className="pointer-events-auto absolute left-1/2 top-4 flex w-[min(90%,920px)] -translate-x-1/2 flex-col gap-2 p-2"
      >
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-2 px-1 text-sm font-medium text-text-dark">
            <ICON_NODE_ASSET_GROUP className="h-4 w-4" />
            {resolveNodeDisplayName(node.type, node.data)}
            <span className="text-xs font-normal text-text-muted">{node.data.memberOrder.length} 个素材 · 已临时展开</span>
          </span>
          {node.data.bindings.map((binding) => {
            const status = summarizeAssetGroupBinding(graph.nodes, graph.edges, node.id, binding);
            return (
              <UiChipButton
                key={binding.id}
                className="h-7 rounded-full px-2 text-2xs text-text-muted"
                disabled={status.excluded === 0}
                title={status.excluded > 0 ? '恢复这个目标的自动连接' : undefined}
                onClick={() => restoreAssetGroupBinding({ groupId: node.id, bindingId: binding.id })}
              >
                {status.connected} 已连 · {status.pending} 待连
                {status.excluded > 0 && <RotateCcw className="h-3 w-3" />}
              </UiChipButton>
            );
          })}
          <UiIconButton className="ml-auto h-7 w-7" aria-label="收起素材组" onClick={onClose}>
            <X className="h-4 w-4" />
          </UiIconButton>
        </div>
        <div className="flex max-w-full gap-1 overflow-x-auto pb-0.5">
          {node.data.memberOrder.map((memberId, index) => {
            const member = graph.nodes.find((item) => item.id === memberId);
            if (!member) return null;
            const order = [...node.data.memberOrder];
            const move = (offset: -1 | 1) => {
              const targetIndex = index + offset;
              if (targetIndex < 0 || targetIndex >= order.length) return;
              [order[index], order[targetIndex]] = [order[targetIndex], order[index]];
              updateAssetGroup({ groupId: node.id, memberOrder: order });
            };
            return (
              <div key={member.id} className="flex shrink-0 items-center gap-0.5 rounded-lg bg-surface-dark p-0.5">
                <UiChipButton
                  className="h-7 max-w-36 px-2 text-2xs text-text-muted"
                  onClick={() => setSelectedNode(member.id)}
                >
                  <span className="truncate">{index + 1}. {resolveNodeDisplayName(member.type, member.data)}</span>
                </UiChipButton>
                <UiIconButton className="h-6 w-6" aria-label="前移素材" disabled={index === 0} onClick={() => move(-1)}>
                  <ChevronLeft className="h-3 w-3" />
                </UiIconButton>
                <UiIconButton className="h-6 w-6" aria-label="后移素材" disabled={index === order.length - 1} onClick={() => move(1)}>
                  <ChevronRight className="h-3 w-3" />
                </UiIconButton>
                <UiIconButton
                  className="h-6 w-6"
                  aria-label="设为封面"
                  disabled={node.data.coverMemberId === member.id}
                  onClick={() => updateAssetGroup({ groupId: node.id, coverMemberId: member.id })}
                >
                  <Star className="h-3 w-3" />
                </UiIconButton>
                <UiIconButton
                  className="h-6 w-6"
                  aria-label="移出素材组"
                  onClick={() => removeAssetGroupMember({ groupId: node.id, memberId: member.id })}
                >
                  <LogOut className="h-3 w-3" />
                </UiIconButton>
              </div>
            );
          })}
        </div>
      </UiPanel>
    </div>
  );
});

AssetGroupFocusOverlay.displayName = 'AssetGroupFocusOverlay';
