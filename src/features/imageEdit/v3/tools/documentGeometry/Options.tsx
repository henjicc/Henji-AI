import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dropdown, UiButton, UiCheckbox, UiError, UiFormRow, UiLoading, UiModal } from '@/components/ui';
import NumberInput from '@/components/ui/NumberInput';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { canvasAnchorSchemaV3, type CanvasAnchorV3 } from '@/core/imageEdit/v3/documentGeometry';
import type { ToolOptionsProps } from '../../toolFramework/types';
import { commitDocumentGeometryV3, prepareDocumentGeometryV3, publishDocumentGeometryPreviewV3, type GeometryDraftV3, type GeometryRequestV3 } from './service';

export function DocumentGeometryOptionsV3({ bus }: ToolOptionsProps): JSX.Element {
  const { t } = useTranslation('ui'), label = (key: string) => t(`imageEditor.v3.documentGeometry.${key}`);
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null), [ready, setReady] = useState(false);
  const [mode, setMode] = useState<GeometryRequestV3['mode']>('canvas'), [anchor, setAnchor] = useState<CanvasAnchorV3>('center');
  const [width, setWidth] = useState(bus.getSnapshot().document.geometry.width), [height, setHeight] = useState(bus.getSnapshot().document.geometry.height);
  const [proportional, setProportional] = useState(true), [protect, setProtect] = useState(Boolean(bus.getSnapshot().selection));
  const draft = useRef<GeometryDraftV3 | null>(null), pending = useRef<AbortController | null>(null);
  const cancel = () => {
    pending.current?.abort(); pending.current = null;
    bus.clearPreview('document-geometry');
    const previous = draft.current; draft.current = null; setReady(false); setBusy(false);
    if (previous) void previous.release().catch(failure => setError(String(failure)));
  };
  useEffect(() => {
    const unsubscribe = bus.subscribe(next => {
      if (draft.current && (next.document !== draft.current.original || next.selectionRevision !== draft.current.selectionVersion)) cancel();
    });
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { cancel(); setOpen(false); } };
    window.addEventListener('keydown', escape);
    return () => { unsubscribe(); window.removeEventListener('keydown', escape); pending.current?.abort(); bus.clearPreview('document-geometry'); if (draft.current) void draft.current.release(); };
  // The bus owns a complete editor lifetime; form changes do not replace this subscription.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bus]);
  const reset = () => { cancel(); setError(null); };
  const preview = async () => {
    reset(); const controller = new AbortController(); pending.current = controller; setBusy(true); setProgress(0);
    try {
      const value = await prepareDocumentGeometryV3(bus, { mode, width, height, anchor, protectSelection: protect }, { signal: controller.signal, onProgress: setProgress });
      if (controller.signal.aborted) { await value.release(); return; }
      draft.current = value; publishDocumentGeometryPreviewV3(bus, value); setReady(true); setOpen(false);
    } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { if (pending.current === controller) { pending.current = null; setBusy(false); } }
  };
  const apply = () => {
    if (!draft.current) return;
    const value = draft.current; draft.current = null;
    try { commitDocumentGeometryV3(bus, value); setReady(false); }
    catch (failure) { setError(String(failure)); void value.release(); }
  };
  const changeSize = (axis: 'width' | 'height', value: number) => {
    reset(); const grid = bus.getSnapshot().document.geometry;
    if (axis === 'width') { setWidth(value); if (mode !== 'canvas' && proportional) setHeight(Math.max(1, Math.round(value * grid.height / grid.width))); }
    else { setHeight(value); if (mode !== 'canvas' && proportional) setWidth(Math.max(1, Math.round(value * grid.width / grid.height))); }
  };
  const grid = bus.getSnapshot().document.geometry;
  return <div className="flex h-full min-w-max items-center gap-3" data-document-size-options>
    <UiButton size="sm" onClick={() => setOpen(true)}>{label('configure')}</UiButton>
    <UiButton size="sm" variant="primary" disabled={!ready} onClick={apply}>{label('apply')}</UiButton>
    <UiButton size="sm" disabled={!ready && !busy} onClick={cancel}>{label('cancel')}</UiButton>
    <span className="text-xs text-text3">{ready ? label('previewHint') : `${grid.width} × ${grid.height}`}</span>
    {error && !open && <UiError size="xs" message={error} />}
    <UiModal isOpen={open} title={label('title')} onClose={() => { cancel(); setOpen(false); }} size="compact"
      footer={<><UiButton onClick={() => { cancel(); setOpen(false); }}>{label('cancel')}</UiButton><UiButton variant="primary" disabled={busy || width === grid.width && height === grid.height} onClick={() => void preview()}>{label('preview')}</UiButton></>}>
      <div className="flex flex-col gap-4" data-document-size-configuration>
        <UiFormRow label={label('mode')}><Dropdown value={mode} display={label(mode)} options={(['canvas', 'resample', 'content-aware'] as const).map(value => ({ value, label: label(value) }))}
          onSelect={value => { reset(); setMode(value as GeometryRequestV3['mode']); }} /></UiFormRow>
        <p className="text-sm text-text2">{label(`${mode}Hint`)}</p>
        {grid.crop && <p className="text-xs text-text3">{label('cropHint')}</p>}
        <UiFormRow label={label('width')}><NumberInput ariaLabel={label('width')} value={width} min={1} step={1} disabled={busy} onChange={value => changeSize('width', value)} /></UiFormRow>
        <UiFormRow label={label('height')}><NumberInput ariaLabel={label('height')} value={height} min={1} step={1} disabled={busy} onChange={value => changeSize('height', value)} /></UiFormRow>
        {mode === 'canvas' ? <UiFormRow label={label('anchor')}><Dropdown value={anchor} display={label(`anchors.${anchor}`)} options={canvasAnchorSchemaV3.options.map(value => ({ value, label: label(`anchors.${value}`) }))} onSelect={value => { reset(); setAnchor(value as CanvasAnchorV3); }} /></UiFormRow>
          : <div className="flex items-center gap-2"><UiCheckbox checked={proportional} onCheckedChange={value => { reset(); setProportional(value); }} aria-label={label('proportional')} /><span>{label('proportional')}</span></div>}
        {mode === 'content-aware' && <div className="flex items-center gap-2"><UiCheckbox checked={protect} onCheckedChange={value => { reset(); setProtect(value); }} aria-label={label('protect')} /><span>{label('protect')}</span></div>}
        {busy && <UiLoading message={label('preparing')}><ProgressBar progress={progress} appearance="hairline" /><UiButton onClick={cancel}>{label('cancel')}</UiButton></UiLoading>}
        {error && <UiError message={error} />}
      </div>
    </UiModal>
  </div>;
}
