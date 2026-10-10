import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Save } from 'lucide-react';
import { UiButton, UiError, UiToolbar } from '@/components/ui';
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
    catch (cause) { if (mounted.current && !task.signal.aborted) setError(cause instanceof Error ? cause.message : '内容更新失败，请重试'); }
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
      if (layer?.type !== 'smart') throw new Error('请选择智能对象');
      const origin = selectedOrigin ?? layer.content.origin;
      if (!origin) throw new Error('此对象为嵌入内容，请选择受管理来源');
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
    <UiToolbar variant="plain" trailing={<UiButton variant="primary" disabled={busy} onClick={apply}><Save className="h-4 w-4" />{editing.applied ? '重试保存并返回' : '应用内容并返回'}</UiButton>}>
      <UiButton disabled={busy} onClick={() => { setEditing(null); setError(null); }}><ArrowLeft className="h-4 w-4" />{editing.applied ? '返回原图片' : '放弃内容修改并返回'}</UiButton>
      <span className="text-xs text-text2">编辑智能对象内容</span>
    </UiToolbar>
    {error ? <UiError size="sm" message={error} /> : null}
    {busy ? <div role="status" className="flex items-center gap-2 px-3 py-2 text-xs text-text2">{!canCancel ? '正在保存内容' : progress === null ? '正在准备内容' : `正在更新内容 ${progress}%`}{canCancel ? <UiButton onClick={view.cancel}>取消</UiButton> : null}</div> : null}
    <div className="min-h-0 flex-1" {...(busy || editing.applied ? { inert: '' } : {})}>{renderEditor({ document: editing.draft, profileId, sourceImageUrl, resourceByteSizes: editing.bytes,
      resourceDescriptors: smartContentDescriptorsV3(editing.draft, editing.bytes), onDocumentChange: updateDraft })}</div>
  </div> : children}</Context.Provider>;
}
