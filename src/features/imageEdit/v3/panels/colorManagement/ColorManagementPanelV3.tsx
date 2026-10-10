import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dropdown, UiButton, UiError, UiFormRow, UiGroup, UiLoading } from '@/components/ui';
import { ProgressBar } from '@/components/ui/ProgressBar';
import type { ColorSettings } from '@/core/imaging/colorManagement';
import type { ImageEditorV3Controller } from '../../editor/types';
import { requireImageEditDocumentInstanceV3 } from '../../application/imageEditDocumentInstances';
import { prepareColorSettingsV3 } from './service';

export function ColorManagementPanelV3({ controller }: { controller: ImageEditorV3Controller }): JSX.Element {
  const { t } = useTranslation('ui'), label = (key: string) => t(`imageEditor.v3.colorManagement.${key}`);
  const [settings, setSettings] = useState<ColorSettings>({ mode: 'convert', ...controller.document.color });
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false), [progress, setProgress] = useState(0);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => { setSettings({ mode: 'convert', ...controller.document.color }); }, [controller.document.color]);
  useEffect(() => () => pending.current?.abort(), [controller.document.id]);
  const change = <K extends keyof ColorSettings>(key: K, value: ColorSettings[K]) => setSettings(previous => ({ ...previous, [key]: value }));
  const apply = async (): Promise<void> => {
    const abort = new AbortController(); pending.current = abort; setBusy(true); setError(null); setProgress(0);
    let release: (() => Promise<void>) | undefined;
    try {
      const { bus } = requireImageEditDocumentInstanceV3(controller.document.id);
      // Do not send ICC/HDR metadata from the display model as unvalidated settings.
      const { mode, workingSpace, bitDepth, transferFunction } = settings;
      const prepared = await prepareColorSettingsV3(bus, { mode, workingSpace, bitDepth, transferFunction }, { signal: abort.signal, onProgress: (done, total) => setProgress(done / Math.max(1, total) * 100) });
      release = prepared.release; abort.signal.throwIfAborted();
      for (const command of prepared.commands) bus.dispatch(command);
    } catch (cause) { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { await release?.(); if (pending.current === abort) { pending.current = null; setBusy(false); } }
  };
  const unchanged = controller.document.color.iccProfileResourceId === null && settings.workingSpace === controller.document.color.workingSpace && settings.bitDepth === controller.document.color.bitDepth && settings.transferFunction === controller.document.color.transferFunction;
  return <section data-color-management-panel className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-3">
    <UiGroup title={label('document')} titleTone="compact">
      <p className="text-sm text-text2" data-document-color>{controller.document.color.workingSpace} · {String(controller.document.color.bitDepth)} · {controller.document.color.transferFunction}</p>
    </UiGroup>
    <UiGroup title={label('configuration')} titleTone="compact">
      {error && <UiError message={error} size="xs" align="start" />}
      <UiFormRow inline density="compact" label={label('mode')}><Dropdown aria-label={label('mode')} value={settings.mode} display={label(settings.mode)} disabled={busy}
        options={(['convert', 'assign'] as const).map(value => ({ value, label: label(value) }))} onSelect={value => change('mode', value as ColorSettings['mode'])} /></UiFormRow>
      <UiFormRow inline density="compact" label={label('profile')}><Dropdown aria-label={label('profile')} value={settings.workingSpace} display={settings.workingSpace} disabled={busy}
        options={(['srgb', 'display-p3', 'rec2020'] as const).map(value => ({ value, label: value }))} onSelect={value => change('workingSpace', value as ColorSettings['workingSpace'])} /></UiFormRow>
      <UiFormRow inline density="compact" label={label('depth')}><Dropdown aria-label={label('depth')} value={String(settings.bitDepth)} display={label(`depths.${settings.bitDepth}`)} disabled={busy}
        options={([8, 16, 'float16', 'float32'] as const).map(value => ({ value: String(value), label: label(`depths.${value}`) }))} onSelect={value => change('bitDepth', value === '8' ? 8 : value === '16' ? 16 : value as 'float16' | 'float32')} /></UiFormRow>
      <UiFormRow inline density="compact" label={label('transfer')}><Dropdown aria-label={label('transfer')} value={settings.transferFunction} display={settings.transferFunction} disabled={busy}
        options={(['srgb', 'linear', 'pq', 'hlg'] as const).map(value => ({ value, label: value }))} onSelect={value => change('transferFunction', value as ColorSettings['transferFunction'])} /></UiFormRow>
      <p className="text-xs text-text3">{label(settings.mode === 'assign' ? 'assignHint' : 'convertHint')}</p>
      <UiButton variant="primary" disabled={busy || unchanged} onClick={() => void apply()}>{label('apply')}</UiButton>
    </UiGroup>
    {busy && <UiLoading message={label('preparing')}><ProgressBar progress={progress} appearance="hairline" /><UiButton onClick={() => pending.current?.abort()}>{label('cancel')}</UiButton></UiLoading>}
    <UiGroup title={label('proof')} titleTone="compact"><p className="text-xs text-text3">{label('proofBoundary')}</p></UiGroup>
  </section>;
}
