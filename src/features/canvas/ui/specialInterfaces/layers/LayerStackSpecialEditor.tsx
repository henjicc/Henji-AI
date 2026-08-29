import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Download, Eye, EyeOff } from 'lucide-react';

import { UiButton, UiError, UiIconButton, UiModal, UiRangeInput, UiSwitch } from '@/components/ui';
import {
  UI_GLASS_ADAPTIVE_REGION_CLASS,
  UI_GLASS_ADAPTIVE_SURFACE_CLASS,
  UI_TEXT_LABEL_CLASS,
  UI_TEXT_META_CLASS,
} from '@/components/ui/styleTokens';
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import { recomposeLayerStackDocument } from '@/features/canvas/application/layerStackApplicationService';
import { applyLayerStackDraft, validateLayerStackDocument, type LayerStackDocumentV1 } from '@/features/canvas/domain/layerStack';
import { getPlatform } from '@/platform/runtime';

import type { CanvasSpecialEditorSurfaceProps } from '../specialEditorRegistry';

interface LayerDraft {
  layerId: string;
  visible: boolean;
  opacity: number;
}

function readDocument(state: Readonly<DynamicValueMap>): LayerStackDocumentV1 | null {
  try {
    return validateLayerStackDocument(state.layerStackDocument as LayerStackDocumentV1);
  } catch {
    return null;
  }
}

export default function LayerStackSpecialEditor({
  session,
  onDraftChange,
  onConfirm,
  onCancel,
  onKeepEditing,
  onDiscard,
}: CanvasSpecialEditorSurfaceProps): JSX.Element {
  const document = useMemo(() => readDocument(session.initialState), [session.initialState]);
  const [order, setOrder] = useState(() => document?.layers.map((layer) => layer.layerId) ?? []);
  const [drafts, setDrafts] = useState<LayerDraft[]>(() => document?.layers.map((layer) => ({ layerId: layer.layerId, visible: layer.visible, opacity: layer.opacity })) ?? []);
  const [selectedId, setSelectedId] = useState(() => document?.layers.at(-1)?.layerId ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeRequestRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  const cancelActiveComposition = useCallback((): void => {
    const requestId = activeRequestRef.current;
    activeRequestRef.current = null;
    if (requestId) {
      void getPlatform().image.cancelLayerStackComposition(requestId).catch(() => undefined);
    }
  }, []);

  useEffect(() => () => {
    mountedRef.current = false;
    cancelActiveComposition();
  }, [cancelActiveComposition]);

  const cancelEditor = useCallback((): void => {
    cancelActiveComposition();
    onCancel();
  }, [cancelActiveComposition, onCancel]);

  if (!document) {
    return (
      <UiModal isOpen title="图层" size="compact" onClose={cancelEditor} footer={<UiButton type="button" variant="primary" size="sm" onClick={cancelEditor}>返回画布</UiButton>}>
        <UiError title="图层数据不可用" message="当前节点没有可编辑的 V1 图层栈；若合成图仍存在，可继续作为普通图片查看。" />
      </UiModal>
    );
  }

  const resourceById = new Map(document.resources.map((resource) => [resource.resourceId, resource]));
  const layerById = new Map(document.layers.map((layer) => [layer.layerId, layer]));
  const selected = layerById.get(selectedId) ?? document.layers.at(-1);
  const selectedResource = selected ? resourceById.get(selected.resourceId) : null;
  const composite = document.resources.find((resource) => resource.resourceId === document.compositeResourceId);
  const previewPath = selectedResource?.filePath ?? composite?.filePath ?? null;

  const patchDraft = (layerId: string, patch: Partial<LayerDraft>): void => {
    setDrafts((current) => current.map((draft) => draft.layerId === layerId ? { ...draft, ...patch } : draft));
  };
  const move = (layerId: string, delta: -1 | 1): void => {
    const layer = layerById.get(layerId);
    if (!layer || layer.role === 'base') return;
    setOrder((current) => {
      const index = current.indexOf(layerId);
      const nextIndex = index + delta;
      if (index <= 0 || nextIndex <= 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };
  const exportSource = async (source: string | null | undefined, name: string): Promise<void> => {
    if (!source) return;
    try {
      setError(null);
      await getPlatform().image.saveImageSourceToDownloads(source, name);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '导出失败');
    }
  };
  const apply = async (): Promise<void> => {
    const requestId = `layer-stack-editor:${crypto.randomUUID()}`;
    activeRequestRef.current = requestId;
    let createdFilePaths: string[] = [];
    let committed = false;
    try {
      setSaving(true);
      setError(null);
      const drafted = applyLayerStackDraft(document, drafts, order);
      const recomposed = await recomposeLayerStackDocument(
        drafted,
        undefined,
        requestId,
        (filePaths) => { createdFilePaths = [...filePaths]; },
      );
      if (activeRequestRef.current !== requestId) {
        if (createdFilePaths.length > 0) {
          await getPlatform().image.releaseLayerStackResources(createdFilePaths).catch(() => undefined);
        }
        return;
      }
      const nextComposite = recomposed.resources.find((resource) => resource.resourceId === recomposed.compositeResourceId);
      const nextThumbnail = recomposed.resources.find((resource) => resource.resourceId === recomposed.thumbnailResourceId);
      onDraftChange({
        ...session.draftState,
        layerStackDocument: recomposed,
        imageUrl: nextComposite?.filePath ?? null,
        previewImageUrl: nextThumbnail?.filePath ?? nextComposite?.filePath ?? null,
        aspectRatio: `${recomposed.canvas.width}:${recomposed.canvas.height}`,
      });
      onConfirm();
      committed = true;
    } catch (nextError) {
      if (!committed && createdFilePaths.length > 0) {
        await getPlatform().image.releaseLayerStackResources(createdFilePaths).catch(() => undefined);
      }
      if (activeRequestRef.current === requestId && mountedRef.current) {
        setError(nextError instanceof Error ? nextError.message : '图层合成失败');
      }
    } finally {
      if (activeRequestRef.current === requestId) activeRequestRef.current = null;
      if (mountedRef.current) setSaving(false);
    }
  };

  return (
    <UiModal
      isOpen
      title={`图层 · ${document.layers.length}`}
      size="workspace"
      surface="glass"
      contentClassName="min-h-0 p-0"
      onClose={cancelEditor}
      footer={session.discardConfirmationRequested ? (
        <div className="flex w-full items-center justify-between gap-3">
          <p className={UI_TEXT_META_CLASS}>有尚未应用的图层设置，确定放弃吗？</p>
          <div className="flex items-center gap-2"><UiButton type="button" variant="ghost" size="sm" onClick={onKeepEditing}>继续编辑</UiButton><UiButton type="button" variant="primary" size="sm" onClick={onDiscard}>放弃更改</UiButton></div>
        </div>
      ) : (
        <><UiButton type="button" variant="ghost" size="sm" onClick={cancelEditor}>取消</UiButton><UiButton type="button" variant="primary" size="sm" disabled={saving} onClick={() => { void apply(); }}>{saving ? '合成中…' : '应用并合成'}</UiButton></>
      )}
    >
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-h-0 flex-col gap-3 p-4">
          <div className={`relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl border border-veil-subtle ${UI_GLASS_ADAPTIVE_SURFACE_CLASS}`}>
            {previewPath ? <img src={resolveImageDisplayUrl(previewPath)} alt={selected?.name ?? '图层预览'} className="max-h-full max-w-full object-contain" /> : <p className="text-sm text-text-muted">所选图层资源缺失</p>}
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className={UI_TEXT_META_CLASS}>预览只解码当前层；确认时由主进程重新合成，不在 React 中处理像素。</p>
            <div className="flex shrink-0 items-center gap-2">
              <UiButton type="button" size="sm" variant="muted" disabled={!selectedResource?.filePath} onClick={() => { void exportSource(selectedResource?.filePath, `${selected?.name ?? 'layer'}.png`); }}><Download className="h-3.5 w-3.5" />单层</UiButton>
              <UiButton type="button" size="sm" variant="muted" disabled={!composite?.filePath} onClick={() => { void exportSource(composite?.filePath, 'layer-stack-composite.png'); }}><Download className="h-3.5 w-3.5" />合成</UiButton>
            </div>
          </div>
          {error && <UiError title="图层操作失败" message={error} />}
        </div>
        <div className={`min-h-0 overflow-y-auto border-l border-veil-subtle p-4 ${UI_GLASS_ADAPTIVE_REGION_CLASS}`}>
          <div className="space-y-2">
            {[...order].reverse().map((layerId) => {
              const layer = layerById.get(layerId);
              const draft = drafts.find((item) => item.layerId === layerId);
              if (!layer || !draft) return null;
              const index = order.indexOf(layerId);
              return (
                <div key={layerId} className={`rounded-lg border px-2.5 py-2 ${selectedId === layerId ? 'border-accent/50 bg-layer' : 'border-veil-subtle bg-surface-dark/40'}`} onClick={() => setSelectedId(layerId)}>
                  <div className="flex items-center gap-2">
                    <UiIconButton type="button" appearance="hover-only" showBorder={false} aria-label={draft.visible ? '隐藏图层' : '显示图层'} onClick={(event) => { event.stopPropagation(); patchDraft(layerId, { visible: !draft.visible }); }}>{draft.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}</UiIconButton>
                    <UiButton type="button" variant="plain" size="sm" className="min-w-0 flex-1 !h-auto !justify-start !px-0 text-left" onClick={() => setSelectedId(layerId)}><span className="min-w-0"><span className="block truncate text-xs font-medium text-text-dark">{layer.name}</span><span className="block truncate text-2xs text-text-soft">{layer.role === 'base' ? '底图 · 固定最底层' : `图层 ${index}`}</span></span></UiButton>
                    <UiIconButton type="button" appearance="hover-only" showBorder={false} aria-label="上移" disabled={layer.role === 'base' || index === order.length - 1} onClick={(event) => { event.stopPropagation(); move(layerId, 1); }}><ChevronUp className="h-4 w-4" /></UiIconButton>
                    <UiIconButton type="button" appearance="hover-only" showBorder={false} aria-label="下移" disabled={layer.role === 'base' || index <= 1} onClick={(event) => { event.stopPropagation(); move(layerId, -1); }}><ChevronDown className="h-4 w-4" /></UiIconButton>
                  </div>
                  {selectedId === layerId && (
                    <div className="mt-2 border-t border-veil-subtle pt-2">
                      <label className="block space-y-1.5"><span className="flex items-center justify-between"><span className={UI_TEXT_LABEL_CLASS}>不透明度</span><span className="text-xs text-text-soft">{Math.round(draft.opacity * 100)}%</span></span><UiRangeInput min={0} max={1} step={0.01} value={draft.opacity} disabled={layer.role === 'base'} onChange={(event) => patchDraft(layerId, { opacity: Number(event.currentTarget.value) })} /></label>
                      <div className="mt-2 flex items-center justify-between"><span className={UI_TEXT_LABEL_CLASS}>可见</span><UiSwitch checked={draft.visible} onCheckedChange={(visible) => patchDraft(layerId, { visible })} /></div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </UiModal>
  );
}
