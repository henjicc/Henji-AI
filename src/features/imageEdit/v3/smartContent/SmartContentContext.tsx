import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Save } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { UiButton, UiError, UiLoading } from '@/components/ui';
import { createImageEditIdV3 } from '@/core/imageEdit/v3/documentFactory';
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes';
import type { ImageEditSmartContentV3, ImageEditSmartOriginV3 } from '@/core/imageEdit/v3/smartContent/types';
import { findImageEditCommandLayerLocationV3 } from '@/core/imageEdit/v3/commandLayerLocation';
import { discardImageEditDocumentInstanceV3, findImageEditDocumentInstanceV3, saveImageEditDocumentInstanceV3 } from '../application/imageEditDocumentInstances';
import type { ImageEditCommandBusV3 } from '../application/imageEditCommandBus';
import type { ImageEditorV3Props } from '../editor/types';
import { convertSmartContentV3, resolveSmartContentSourceV3, smartContentDescriptorsV3, updateSmartContentV3 } from './service';

interface SmartContentView {
  busy: boolean; canCancel: boolean; error: string | null; progress: number | null;
  open(layerId: string): void;
  convert(layerId: string, type: 'smart' | 'raster'): Promise<void>;
  refresh(layerId: string, origin?: ImageEditSmartOriginV3): Promise<void>;
  cancel(): void;
}
const Context = createContext<SmartContentView | null>(null);
// eslint-disable-next-line react-refresh/only-export-components -- 工作区 context 与订阅钩子同源。
export function useSmartContentV3(): SmartContentView | null { return useContext(Context); }
interface EditingContent { layerId: string; originalId: string; originalContent: ImageEditSmartContentV3; draft: ImageEditDocumentV3; applied: boolean; bytes: Readonly<Record<string, number>> }

export function SmartContentProviderV3({ bus, children, renderEditor, profileId, sourceImageUrl }: {
  bus: ImageEditCommandBusV3; children: ReactNode; renderEditor(props: ImageEditorV3Props): ReactNode;
  profileId: ImageEditorV3Props['profileId']; sourceImageUrl: string;
}): JSX.Element {
  const { t } = useTranslation('ui');
  const label = (key: string) => t(`imageEditor.v3.smartContentEditing.${key}`);
  const [editing, setEditing] = useState<EditingContent | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [progress, setProgress] = useState<number | null>(null);
  const [canCancel, setCanCancel] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const updateDraft = useCallback((draft: ImageEditDocumentV3) => setEditing(value => value && value.draft !== draft ? { ...value, draft } : value), []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; abort.current?.abort(); }; }, []);
  useEffect(() => { const id = editing?.draft.id; return () => { if (id) setTimeout(() => discardImageEditDocumentInstanceV3(id), 0); }; }, [editing?.draft.id]);
  async function persist(): Promise<void> {
    setCanCancel(false);
    if (findImageEditDocumentInstanceV3(bus.getSnapshot().document.id)?.persistenceOwner) await saveImageEditDocumentInstanceV3(bus.getSnapshot().document.id, true);
  }
  async function run(execute: (signal: AbortSignal) => Promise<void>): Promise<void> {
    if (abort.current) return;
    const task = new AbortController(); abort.current = task; setBusy(true); setCanCancel(!editing?.applied); setError(null);
    try { await execute(task.signal); }
    catch (cause) { if (mounted.current && !task.signal.aborted) setError(cause instanceof Error ? cause.message : label('failed')); }
    finally { abort.current = null; if (mounted.current) { setBusy(false); setCanCancel(false); setProgress(null); } }
  }
  const view: SmartContentView = {
    busy, canCancel, error, progress,
    open(layerId) {
      const layer = findImageEditCommandLayerLocationV3(bus.getSnapshot().document.layers, layerId)?.layer;
      if (layer?.type !== 'smart') return;
      setError(null); setEditing({ layerId, originalId: layer.content.document.id, originalContent: layer.content, draft: { ...structuredClone(layer.content.document), id: createImageEditIdV3('content-draft') },
        applied: false, bytes: bus.getResourceByteSizes() });
    },
    convert: (layerId, type) => run(async signal => { signal.throwIfAborted(); convertSmartContentV3(bus, layerId, type); await persist(); }),
    refresh: (layerId, selectedOrigin) => run(async signal => {
      const layer = findImageEditCommandLayerLocationV3(bus.getSnapshot().document.layers, layerId)?.layer;
      if (layer?.type !== 'smart') throw new Error(label('selectSmartObject'));
      const origin = selectedOrigin ?? layer.content.origin;
      if (!origin) throw new Error(label('selectManagedSource'));
      const resolved = await resolveSmartContentSourceV3(origin, signal);
      const document = { ...resolved.document, id: layer.content.document.id };
      await updateSmartContentV3(bus, layerId, document, { origin, bytes: resolved.bytes, signal,
        onProgress: (done, total) => setProgress(Math.floor(done / total * 100)) });
      await persist();
    }),
    cancel: () => { abort.current?.abort(); },
  };
  const apply = (): void => { if (!editing) return; void run(async signal => {
    if (!editing.applied) {
      const draftBus = findImageEditDocumentInstanceV3(editing.draft.id)?.bus;
      const content = { ...(draftBus?.getSnapshot().document ?? editing.draft), id: editing.originalId };
      await updateSmartContentV3(bus, editing.layerId, content, { signal, expectedContent: editing.originalContent, bytes: draftBus?.getResourceByteSizes() ?? editing.bytes,
        onProgress: (done, total) => setProgress(Math.floor(done / total * 100)) });
      setEditing(value => value ? { ...value, applied: true } : value);
    }
    await persist();
    if (mounted.current) setEditing(null);
  }); };
  return <Context.Provider value={view}>{editing ? <div className="flex h-full min-h-0 flex-col" data-smart-content-editor>
    {error ? <UiError size="sm" message={error} /> : null}
    {busy ? <UiLoading size="xs" message={!canCancel ? label('saving') : progress === null ? label('preparing') : label('updating')}>
      {progress !== null && <span className="text-xs text-text2">{progress}%</span>}{canCancel ? <UiButton onClick={view.cancel}>{label('cancel')}</UiButton> : null}
    </UiLoading> : null}
    <div className="min-h-0 flex-1">{renderEditor({ document: editing.draft, profileId, sourceImageUrl, resourceByteSizes: editing.bytes,
      resourceDescriptors: smartContentDescriptorsV3(editing.draft, editing.bytes), onDocumentChange: updateDraft,
      contentDisabled: busy || editing.applied,
      toolbarLeading: <UiButton disabled={busy} onClick={() => { setEditing(null); setError(null); }}><ArrowLeft  />{label(editing.applied ? 'return' : 'discard')}</UiButton>,
      toolbarActions: <UiButton variant="primary" disabled={busy} onClick={apply}><Save  />{label(editing.applied ? 'retrySave' : 'apply')}</UiButton>,
    })}</div>
  </div> : children}</Context.Provider>;
}
