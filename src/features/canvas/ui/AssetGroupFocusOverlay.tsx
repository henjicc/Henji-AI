import { memo, useMemo } from 'react';
import { ArrowLeft, ArrowRight, LogOut, RotateCcw, Star, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';

import {
  UI_HIGHLIGHT_RING_INSET_CLASS,
  UI_META_BADGE_ACCENT_CLASS,
  UI_META_BADGE_CLASS,
  UI_TEXT_META_CLASS,
  UI_TEXT_TITLE_CLASS,
  UiButton,
  UiEmpty,
  UiIconButton,
  UiPanel,
} from '@/components/ui';
import {
  ICON_MEDIA_AUDIO,
  ICON_MEDIA_IMAGE,
  ICON_MEDIA_VIDEO,
  ICON_NODE_ASSET_GROUP,
} from '@/core/theme/icons';
import {
  removeAssetGroupMember,
  restoreAssetGroupBinding,
  updateAssetGroup,
} from '@/features/canvas/application/assetGroupApplicationService';
import {
  resolveAssetGroupMemberKind,
  summarizeAssetGroupBinding,
} from '@/features/canvas/application/assetGroupGraph';
import { isAssetGroupNode, type CanvasNode } from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { AssetGroupPreview } from '@/features/canvas/nodes/assetGroup/AssetGroupPreview';
import { resolveAssetGroupPreviewItems } from '@/features/canvas/nodes/assetGroup/assetGroupPreviewModel';
import { useCanvasStore } from '@/stores/canvasStore';

interface AssetGroupFocusOverlayProps {
  groupId: string;
  onClose: () => void;
}

const MEDIA_ICON = {
  image: ICON_MEDIA_IMAGE,
  video: ICON_MEDIA_VIDEO,
  audio: ICON_MEDIA_AUDIO,
};

function moveMember(order: string[], index: number, offset: -1 | 1): string[] | null {
  const targetIndex = index + offset;
  if (targetIndex < 0 || targetIndex >= order.length) return null;
  const next = [...order];
  [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
  return next;
}

export const AssetGroupFocusOverlay = memo(({ groupId, onClose }: AssetGroupFocusOverlayProps) => {
  const { t } = useTranslation();
  const graph = useCanvasStore(useShallow((state) => ({ nodes: state.nodes, edges: state.edges })));
  const node = graph.nodes.find((item) => item.id === groupId);
  const members = useMemo(() => {
    if (!node || !isAssetGroupNode(node)) return [];
    const memberById = new Map(graph.nodes.map((item) => [item.id, item] as const));
    return node.data.memberOrder
      .map((memberId) => memberById.get(memberId))
      .filter((member): member is CanvasNode => Boolean(member));
  }, [graph.nodes, node]);
  const previewByMemberId = useMemo(() => {
    if (!node || !isAssetGroupNode(node)) return new Map();
    return new Map(resolveAssetGroupPreviewItems(members, node.data).map((item) => [item.id, item] as const));
  }, [members, node]);

  if (!node || !isAssetGroupNode(node)) return null;

  return (
    <section
      aria-label={t('canvas.assetGroup.manager.label')}
      className="absolute inset-0 z-panel flex min-h-0 flex-col bg-app text-text-dark"
    >
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border-dark bg-panel px-4">
        <ICON_NODE_ASSET_GROUP className="h-5 w-5 shrink-0 text-text-soft" />
        <div className="min-w-0">
          <h2 className={`truncate ${UI_TEXT_TITLE_CLASS}`}>
            {resolveNodeDisplayName(node.type, node.data)}
          </h2>
          <p className={UI_TEXT_META_CLASS}>
            {t('canvas.assetGroup.manager.memberCount', { count: members.length })}
          </p>
        </div>
        <UiIconButton
          appearance="hover-only"
          showBorder={false}
          className="ml-auto h-8 w-8"
          aria-label={t('canvas.assetGroup.manager.close')}
          title={t('canvas.assetGroup.manager.close')}
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </UiIconButton>
      </header>

      <div className="nowheel min-h-0 flex-1 overflow-y-auto p-4">
        {members.length === 0 ? (
          <UiEmpty
            title={t('canvas.assetGroup.manager.emptyTitle')}
            description={t('canvas.assetGroup.manager.emptyDescription')}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {members.map((member, index) => {
              const kind = resolveAssetGroupMemberKind(member) ?? 'image';
              const KindIcon = MEDIA_ICON[kind];
              const preview = previewByMemberId.get(member.id);
              const isCover = node.data.coverMemberId === member.id;
              return (
                <UiPanel
                  key={member.id}
                  variant="inset"
                  data-asset-group-manager-member={member.id}
                  className={`min-w-0 overflow-hidden ${isCover ? UI_HIGHLIGHT_RING_INSET_CLASS : ''}`}
                >
                  <div className="relative aspect-video overflow-hidden bg-app">
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
                      <span className={`absolute right-2 top-2 flex items-center gap-1 text-2xs ${UI_META_BADGE_ACCENT_CLASS}`}>
                        <Star className="h-3 w-3" />
                        {t('canvas.assetGroup.manager.cover')}
                      </span>
                    )}
                  </div>
                  <div className="flex min-w-0 items-center gap-2 p-3">
                    <KindIcon className="h-4 w-4 shrink-0 text-text-muted" />
                    <span className="min-w-0 flex-1 truncate text-sm text-text-dark">
                      {resolveNodeDisplayName(member.type, member.data)}
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      <UiIconButton
                        appearance="hover-only"
                        showBorder={false}
                        className="h-8 w-8"
                        aria-label={t('canvas.assetGroup.manager.moveEarlier')}
                        title={t('canvas.assetGroup.manager.moveEarlier')}
                        disabled={index === 0}
                        onClick={() => {
                          const memberOrder = moveMember(node.data.memberOrder, index, -1);
                          if (memberOrder) updateAssetGroup({ groupId: node.id, memberOrder });
                        }}
                      >
                        <ArrowLeft className="h-4 w-4" />
                      </UiIconButton>
                      <UiIconButton
                        appearance="hover-only"
                        showBorder={false}
                        className="h-8 w-8"
                        aria-label={t('canvas.assetGroup.manager.moveLater')}
                        title={t('canvas.assetGroup.manager.moveLater')}
                        disabled={index === members.length - 1}
                        onClick={() => {
                          const memberOrder = moveMember(node.data.memberOrder, index, 1);
                          if (memberOrder) updateAssetGroup({ groupId: node.id, memberOrder });
                        }}
                      >
                        <ArrowRight className="h-4 w-4" />
                      </UiIconButton>
                      <UiIconButton
                        appearance="hover-only"
                        showBorder={false}
                        active={isCover}
                        className="h-8 w-8"
                        aria-label={t('canvas.assetGroup.manager.setCover')}
                        title={t('canvas.assetGroup.manager.setCover')}
                        disabled={isCover}
                        onClick={() => updateAssetGroup({ groupId: node.id, coverMemberId: member.id })}
                      >
                        <Star className="h-4 w-4" />
                      </UiIconButton>
                      <UiIconButton
                        appearance="hover-only"
                        showBorder={false}
                        hoverVariant="danger"
                        className="h-8 w-8"
                        aria-label={t('canvas.assetGroup.manager.remove')}
                        title={t('canvas.assetGroup.manager.remove')}
                        onClick={() => removeAssetGroupMember({ groupId: node.id, memberId: member.id })}
                      >
                        <LogOut className="h-4 w-4" />
                      </UiIconButton>
                    </div>
                  </div>
                </UiPanel>
              );
            })}
          </div>
        )}
      </div>

      {node.data.bindings.length > 0 && (
        <footer className="flex shrink-0 flex-wrap items-center gap-3 border-t border-border-dark bg-panel px-4 py-2">
          <span className="text-xs font-medium text-text-soft">
            {t('canvas.assetGroup.manager.connections')}
          </span>
          {node.data.bindings.map((binding) => {
            const status = summarizeAssetGroupBinding(graph.nodes, graph.edges, node.id, binding);
            const target = graph.nodes.find((item) => item.id === binding.targetNodeId);
            return (
              <div key={binding.id} className="flex min-w-0 items-center gap-2 text-xs text-text-muted">
                <span className="max-w-48 truncate">
                  {target ? resolveNodeDisplayName(target.type, target.data) : t('canvas.assetGroup.manager.unknownTarget')}
                </span>
                <span>{t('canvas.assetGroup.manager.connectionStatus', {
                  connected: status.connected,
                  pending: status.pending,
                  unsupported: status.unsupported,
                })}</span>
                {status.excluded > 0 && (
                  <UiButton
                    variant="plain"
                    size="sm"
                    className="h-7 gap-1 px-2"
                    onClick={() => restoreAssetGroupBinding({ groupId: node.id, bindingId: binding.id })}
                  >
                    <RotateCcw className="h-3 w-3" />
                    {t('canvas.assetGroup.manager.restore')}
                  </UiButton>
                )}
              </div>
            );
          })}
        </footer>
      )}
    </section>
  );
});

AssetGroupFocusOverlay.displayName = 'AssetGroupFocusOverlay';
