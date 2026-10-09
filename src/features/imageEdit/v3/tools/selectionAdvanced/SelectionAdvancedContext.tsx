import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ImageEditAdvancedSelectionIntentV3 } from '@/core/imageEdit/v3/selection/advanced';
import type { ImageEditSelectionSessionV3 } from '@/core/imageEdit/v3/selection/session';
import type { ImageEditCommandBusV3 } from '../../application/imageEditCommandBus';
import type { ImageEditorV3Controller } from '../../editor/types';
import { useImageEditorSessionStoreV3 } from '../../store';
import { applyImageEditSelectionPreviewV3, previewImageEditSelectionIntentV3 } from './service';

type Preview = Awaited<ReturnType<typeof previewImageEditSelectionIntentV3>>;
interface View {
  tolerance: number; contiguous: boolean; range: number; noise: number;
  points: { x: number; y: number }[]; busy: boolean; progress: number; error: string | null;
  preview: ImageEditSelectionSessionV3 | null;
  configure(patch: Partial<Pick<View, 'tolerance' | 'contiguous' | 'range' | 'noise' | 'points'>>): void;
  sample(point: { x: number; y: number }): void;
  run(intent?: ImageEditAdvancedSelectionIntentV3): Promise<void>;
  apply(): void; cancel(): void;
}
const Context = createContext<View | null>(null);
// eslint-disable-next-line react-refresh/only-export-components -- 同源预览会话与订阅钩子。
export function useSelectionAdvancedV3(): View | null { return useContext(Context); }
export function SelectionAdvancedProviderV3({ bus, controller, children }: { bus: ImageEditCommandBusV3; controller: Pick<ImageEditorV3Controller, 'sessionId'>; children: ReactNode }): JSX.Element {
  const session = useImageEditorSessionStoreV3(state => state.sessions[controller.sessionId]);
  const [settings, setSettings] = useState({ tolerance: .12, contiguous: true, range: .5, noise: .03, points: [] as { x: number; y: number }[] });
  const [preview, setPreview] = useState<Preview | null>(null), [busy, setBusy] = useState(false), [progress, setProgress] = useState(0), [error, setError] = useState<string | null>(null);
  const selectedLayerKey = session?.selectedLayerIds.join(':');
  const job = useRef<AbortController | null>(null), mounted = useRef(true);
  const cancel = (): void => { job.current?.abort(); job.current = null; setBusy(false); setPreview(null); setError(null); };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; job.current?.abort(); }; }, [bus]);
  useEffect(() => { cancel(); setSettings(current => ({ ...current, points: [] })); }, [bus, session?.activeTool, selectedLayerKey]);
  useEffect(() => { cancel(); }, [session?.toolSettings.selectionCombineMode]);
  useEffect(() => {
    let baseline = bus.getSnapshot();
    return bus.subscribe(next => {
      if (baseline.document.revision !== next.document.revision || baseline.selectionRevision !== next.selectionRevision) cancel();
      baseline = next;
    });
  }, [bus]);
  const configure: View['configure'] = patch => { cancel(); setSettings(current => ({ ...current, ...patch })); };
  async function run(intent?: ImageEditAdvancedSelectionIntentV3): Promise<void> {
    job.current?.abort(); const task = new AbortController(); job.current = task; setBusy(true); setPreview(null); setError(null); setProgress(0);
    try {
      const current = useImageEditorSessionStoreV3.getState().sessions[controller.sessionId];
      const operation = intent ?? (current?.activeTool === 'select-focus' ? { kind: 'focus' as const, range: settings.range, noise: settings.noise }
        : current?.activeTool === 'select-color-range' ? { kind: 'color-range' as const, points: settings.points, tolerance: settings.tolerance }
          : { kind: 'wand' as const, point: settings.points.at(-1) ?? { x: .5, y: .5 }, tolerance: settings.tolerance, contiguous: settings.contiguous });
      if (operation.kind !== 'modify' && current?.selectedLayerIds.length !== 1) throw new Error('请选择一个可见的像素图层');
      if (operation.kind === 'wand' && !settings.points.length && !intent) throw new Error('请先在画面上点击取样');
      const result = await previewImageEditSelectionIntentV3(bus, current?.selectedLayerIds[0] ?? null, operation, current?.toolSettings.selectionCombineMode,
        { signal: task.signal, onProgress: (done, total) => { if (job.current === task && mounted.current) setProgress(total ? done / total : 0); } });
      if (mounted.current && job.current === task && !task.signal.aborted) setPreview(result);
    } catch (cause) { if (mounted.current && job.current === task && !task.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (job.current === task) { job.current = null; if (mounted.current) setBusy(false); } }
  }
  function sample(point: { x: number; y: number }): void { configure({ points: session?.activeTool === 'select-color-range' ? [...settings.points, point] : [point] }); }
  function apply(): void {
    if (!preview) return;
    try { applyImageEditSelectionPreviewV3(bus, preview); setPreview(null); setError(null); }
    catch (cause) { setPreview(null); setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  return <Context.Provider value={{ ...settings, preview: preview?.result ?? null, busy, progress, error, configure, sample, run, apply, cancel }}>{children}</Context.Provider>;
}
