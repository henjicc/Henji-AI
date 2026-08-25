import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, RotateCcw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';

import {
  UI_TEXT_BODY_CLASS,
  UI_TEXT_META_CLASS,
  UI_TEXT_TITLE_CLASS,
  UiButton,
  UiCheckbox,
  UiEmpty,
  UiIconButton,
  UiInput,
  UiModal,
} from '@/components/ui';
import { ICON_NODE_ASSET_GROUP } from '@/core/theme/icons';
import { readAssetDragPayload } from '@/features/assets/drag/assetDragPayload';
import {
  addAssetToAssetGroup,
  importFilesToAssetGroup,
  removeAssetGroupMember,
  restoreAssetGroupBinding,
  updateAssetGroup,
} from '@/features/canvas/application/assetGroupApplicationService';
import {
  reorderAssetGroupMembersWithinKind,
  resolveAssetGroupMemberKind,
  summarizeAssetGroupBinding,
} from '@/features/canvas/application/assetGroupGraph';
import { canvasEventBus } from '@/features/canvas/application/canvasServices';
import { isAssetGroupNode, type CanvasNode } from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import type { RowMediaKind } from '@/features/canvas/domain/socketTypes';
import { resolveAssetGroupPreviewItems } from '@/features/canvas/nodes/assetGroup/assetGroupPreviewModel';
import { AssetGroupMediaViewers } from '@/features/canvas/ui/AssetGroupMediaViewers';
import { AssetGroupMemberSection } from '@/features/canvas/ui/AssetGroupMemberSection';
import { useCanvasStore } from '@/stores/canvasStore';

interface AssetGroupFocusOverlayProps {
  groupId: string;
  onClose: () => void;
}

const MEDIA_KINDS: RowMediaKind[] = ['image', 'video', 'audio'];

export const AssetGroupFocusOverlay = memo(({ groupId, onClose }: AssetGroupFocusOverlayProps) => {
  const { t } = useTranslation();
  const graph = useCanvasStore(useShallow((state) => ({ nodes: state.nodes, edges: state.edges })));
  const node = graph.nodes.find((item) => item.id === groupId);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const [isDraggingMedia, setIsDraggingMedia] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [removeCandidateId, setRemoveCandidateId] = useState<string | null>(null);
  const [skipRemoveConfirmation, setSkipRemoveConfirmation] = useState(false);
  const [skipCheckedInDialog, setSkipCheckedInDialog] = useState(false);
  const [viewerMemberId, setViewerMemberId] = useState<string | null>(null);

  useEffect(() => {
    setSkipRemoveConfirmation(false);
    setSkipCheckedInDialog(false);
    setRemoveCandidateId(null);
    setViewerMemberId(null);
  }, [groupId]);

  const members = useMemo(() => {
    if (!node || !isAssetGroupNode(node)) return [];
    const memberById = new Map(graph.nodes.map((item) => [item.id, item] as const));
    return node.data.memberOrder
      .map((memberId) => memberById.get(memberId))
      .filter((member): member is CanvasNode => Boolean(member));
  }, [graph.nodes, node]);
  const membersByKind = useMemo(() => Object.fromEntries(MEDIA_KINDS.map((kind) => [
    kind,
    members.filter((member) => resolveAssetGroupMemberKind(member) === kind),
  ])) as Record<RowMediaKind, CanvasNode[]>, [members]);
  const previewByMemberId = useMemo(() => {
    if (!node || !isAssetGroupNode(node)) return new Map();
    return new Map(resolveAssetGroupPreviewItems(members, node.data).map((item) => [item.id, item] as const));
  }, [members, node]);

  const importFiles = useCallback(async (files: readonly File[]) => {
    if (files.length === 0 || isImporting) return;
    setIsImporting(true);
    try {
      const result = await importFilesToAssetGroup({ groupId, files });
      const hasSkipped = result.skipped + result.failed > 0;
      canvasEventBus.publish('canvas/toast', {
        message: result.added > 0
          ? hasSkipped
            ? t('canvas.assetGroup.manager.addedWithSkipped', {
              count: result.added,
              skipped: result.skipped + result.failed,
            })
            : t('canvas.assetGroup.manager.added', { count: result.added })
          : t('canvas.assetGroup.manager.addUnsupported'),
        type: result.added > 0 ? 'success' : 'error',
      });
    } catch (error) {
      canvasEventBus.publish('canvas/toast', {
        message: error instanceof Error ? error.message : t('canvas.assetGroup.manager.addFailed'),
        type: 'error',
      });
    } finally {
      setIsImporting(false);
    }
  }, [groupId, isImporting, t]);

  if (!node || !isAssetGroupNode(node)) return null;

  const requestRemove = (memberId: string): void => {
    if (skipRemoveConfirmation) {
      removeAssetGroupMember({ groupId: node.id, memberId });
      if (viewerMemberId === memberId) setViewerMemberId(null);
      return;
    }
    setSkipCheckedInDialog(false);
    setRemoveCandidateId(memberId);
  };
  const confirmRemove = (): void => {
    if (!removeCandidateId) return;
    removeAssetGroupMember({ groupId: node.id, memberId: removeCandidateId });
    if (viewerMemberId === removeCandidateId) setViewerMemberId(null);
    if (skipCheckedInDialog) setSkipRemoveConfirmation(true);
    setRemoveCandidateId(null);
  };
  const isSupportedDrag = (event: React.DragEvent): boolean => (
    event.dataTransfer.types.includes('application/x-henji-drag-data')
    || event.dataTransfer.types.includes('Files')
  );

  return (
    <section
      aria-label={t('canvas.assetGroup.manager.label')}
      className="absolute inset-0 z-panel flex min-h-0 flex-col bg-app text-text-dark"
      onDragEnter={(event) => {
        if (!isSupportedDrag(event)) return;
        event.preventDefault();
        dragDepthRef.current += 1;
        setIsDraggingMedia(true);
      }}
      onDragOver={(event) => {
        if (!isSupportedDrag(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(event) => {
        if (!isSupportedDrag(event)) return;
        event.preventDefault();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setIsDraggingMedia(false);
      }}
      onDrop={(event) => {
        if (!isSupportedDrag(event)) return;
        event.preventDefault();
        dragDepthRef.current = 0;
        setIsDraggingMedia(false);
        const asset = readAssetDragPayload(event.dataTransfer);
        if (asset) {
          try {
            addAssetToAssetGroup({ groupId: node.id, asset });
            canvasEventBus.publish('canvas/toast', {
              message: t('canvas.assetGroup.manager.added', { count: 1 }),
              type: 'success',
            });
          } catch (error) {
            canvasEventBus.publish('canvas/toast', {
              message: error instanceof Error ? error.message : t('canvas.assetGroup.manager.addFailed'),
              type: 'error',
            });
          }
          return;
        }
        void importFiles(Array.from(event.dataTransfer.files));
      }}
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
        <UiButton
          variant="muted"
          size="sm"
          className="ml-auto h-8 gap-1.5 px-3"
          disabled={isImporting}
          onClick={() => inputRef.current?.click()}
        >
          <Plus className="h-4 w-4" />
          {isImporting ? t('canvas.assetGroup.manager.adding') : t('canvas.assetGroup.manager.addMedia')}
        </UiButton>
        <UiInput
          ref={inputRef}
          type="file"
          accept="image/*,video/*,audio/*"
          multiple
          className="hidden"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = '';
            void importFiles(files);
          }}
        />
        <UiIconButton
          appearance="hover-only"
          showBorder={false}
          className="h-8 w-8"
          aria-label={t('canvas.assetGroup.manager.close')}
          title={t('canvas.assetGroup.manager.close')}
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </UiIconButton>
      </header>

      <div className="nowheel relative min-h-0 flex-1 overflow-y-auto p-4">
        {isDraggingMedia && (
          <div className="pointer-events-none absolute inset-3 z-raised flex items-center justify-center rounded-xl border border-dashed border-accent bg-app/85 text-sm font-medium text-accent">
            {t('canvas.assetGroup.manager.dropMedia')}
          </div>
        )}
        {members.length === 0 ? (
          <UiEmpty
            title={t('canvas.assetGroup.manager.emptyTitle')}
            description={t('canvas.assetGroup.manager.emptyDescription')}
          />
        ) : (
          <div className="space-y-6">
            {MEDIA_KINDS.map((kind) => (
              <AssetGroupMemberSection
                key={kind}
                kind={kind}
                title={t(`canvas.assetGroup.manager.kind.${kind}`)}
                members={membersByKind[kind]}
                coverMemberId={node.data.coverMemberId}
                previewByMemberId={previewByMemberId}
                labels={{
                  cover: t('canvas.assetGroup.manager.cover'),
                  setCover: t('canvas.assetGroup.manager.setCover'),
                  moveEarlier: t('canvas.assetGroup.manager.moveEarlier'),
                  moveLater: t('canvas.assetGroup.manager.moveLater'),
                  remove: t('canvas.assetGroup.manager.remove'),
                  dragHint: t('canvas.assetGroup.manager.dragHint'),
                  openViewer: t('canvas.assetGroup.manager.openViewer'),
                }}
                onReorder={(fromIndex, toIndex) => updateAssetGroup({
                  groupId: node.id,
                  memberOrder: reorderAssetGroupMembersWithinKind(
                    graph.nodes,
                    node.data.memberOrder,
                    kind,
                    fromIndex,
                    toIndex,
                  ),
                })}
                onSetCover={(memberId) => updateAssetGroup({ groupId: node.id, coverMemberId: memberId })}
                onRemoveRequest={requestRemove}
                onOpenViewer={setViewerMemberId}
              />
            ))}
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

      <UiModal
        isOpen={Boolean(removeCandidateId)}
        title={t('canvas.assetGroup.manager.removeConfirmTitle')}
        onClose={() => setRemoveCandidateId(null)}
        footer={(
          <>
            <UiButton variant="muted" size="sm" onClick={() => setRemoveCandidateId(null)}>
              {t('common.cancel')}
            </UiButton>
            <UiButton variant="muted" size="sm" className="text-danger hover:bg-danger/10" onClick={confirmRemove}>
              {t('canvas.assetGroup.manager.removeConfirmAction')}
            </UiButton>
          </>
        )}
      >
        <p className={UI_TEXT_BODY_CLASS}>{t('canvas.assetGroup.manager.removeConfirmMessage')}</p>
        <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-text-soft">
          <UiCheckbox
            checked={skipCheckedInDialog}
            onCheckedChange={setSkipCheckedInDialog}
            aria-label={t('canvas.assetGroup.manager.skipRemoveConfirmation')}
          />
          {t('canvas.assetGroup.manager.skipRemoveConfirmation')}
        </label>
      </UiModal>

      <AssetGroupMediaViewers
        members={members}
        selectedMemberId={viewerMemberId}
        onSelectMember={setViewerMemberId}
        onClose={() => setViewerMemberId(null)}
      />
    </section>
  );
});

AssetGroupFocusOverlay.displayName = 'AssetGroupFocusOverlay';
