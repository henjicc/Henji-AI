import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { UiButton, UiEmpty, UiError, UiFormRow, UiLoading, UiModal, PromptEditor } from '@/components/ui';
import NumberInput from '@/components/ui/NumberInput';
import { ProgressBar } from '@/components/ui/ProgressBar';
import ModelSelectorPanel from '@/components/MediaGenerator/components/ModelSelectorPanel';
import { parseLegacyPromptString, toPromptPlainText } from '@/core/inputs/promptDocument';
import { requestAlertConfirmation } from '@/stores/alertDialogStore';
import { registry } from '@/core/ModelRegistry';
import { getI18nText } from '@/core/types';
import { formatPriceEstimate, readPriceEstimateDisplaySettings } from '@/core/pricing/priceDisplay';
import type { GenerationModelFilterType } from '@/features/generation';
import type { ToolOptionsProps } from '../../toolFramework/types';
import { imageEditOutpaintVersionV3, listImageEditOutpaintJobsV3, subscribeImageEditOutpaintV3 } from '../../application/imageEditOutpaintJobsV3';
const loadOutpaint = () => import('../../application/imageEditOutpaintServiceV3');

function useJobs(documentId: string) {
  useSyncExternalStore(subscribeImageEditOutpaintV3, imageEditOutpaintVersionV3, imageEditOutpaintVersionV3);
  return listImageEditOutpaintJobsV3(documentId);
}
export function OutpaintStatusV3({ bus }: ToolOptionsProps): JSX.Element | null {
  const { t } = useTranslation('ui');
  const job = useJobs(bus.getSnapshot().document.id).filter(value => value.status !== 'placed' && value.status !== 'cancelled').at(-1);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => setFailure(null), [job?.taskId]);
  if (!job) return null;
  const invoke = async (action: () => Promise<unknown>) => { try { setFailure(null); await action(); } catch (error) { setFailure(error instanceof Error ? error.message : String(error)); } };
  return <div data-outpaint-status className="pointer-events-auto absolute bottom-3 left-3 max-w-sm rounded-lg bg-panel px-4 py-2 shadow-lg">
    {job.status === 'failed' || failure ? <UiError size="xs" align="start" message={failure ?? job.error ?? t('imageEditor.v3.outpaint.failed')}
      actions={<><UiButton size="sm" onClick={() => void invoke(async () => (await loadOutpaint()).recoverImageEditOutpaintV3(job.documentId, job.taskId))}>{t('imageEditor.v3.outpaint.recover')}</UiButton>
        {!job.layerId && <UiButton size="sm" onClick={() => void invoke(async () => (await loadOutpaint()).cancelImageEditOutpaintV3(job.taskId))}>{t('imageEditor.v3.outpaint.cancel')}</UiButton>}</>} />
      : <UiLoading size="xs" message={t(`imageEditor.v3.outpaint.${job.status}`)}><ProgressBar progress={job.progress} appearance="hairline" />
        <UiButton size="sm" disabled={Boolean(job.layerId)} onClick={() => void invoke(async () => (await loadOutpaint()).cancelImageEditOutpaintV3(job.taskId))}>{t('imageEditor.v3.outpaint.cancel')}</UiButton></UiLoading>}
  </div>;
}
export function OutpaintOptionsV3({ bus }: ToolOptionsProps): JSX.Element {
  const { t, i18n } = useTranslation('ui'), text = (key: string) => t(`imageEditor.v3.outpaint.${key}`);
  const [open, setOpen] = useState(false), [picking, setPicking] = useState(false);
  const [left, setLeft] = useState(0), [top, setTop] = useState(0);
  const [right, setRight] = useState(25), [bottom, setBottom] = useState(0);
  const [prompt, setPrompt] = useState(() => parseLegacyPromptString(''));
  const [modelId, setModelId] = useState(''), [providerId, setProviderId] = useState('');
  const [filterProvider, setFilterProvider] = useState('all'), [filterType, setFilterType] = useState<GenerationModelFilterType>('image'), [filterFunction, setFilterFunction] = useState('all');
  const [favorites, setFavorites] = useState(() => new Set<string>());
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const documentId = bus.getSnapshot().document.id;
  useEffect(() => {
    const controller = new AbortController();
    void loadOutpaint().then(service => service.restoreImageEditOutpaintJobsV3(documentId, controller.signal))
      .catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure)); });
    return () => controller.abort();
  }, [documentId]);
  const active = useJobs(documentId).some(job => ['preparing', 'generating', 'placing'].includes(job.status));
  const begin = async () => {
    setBusy(true); setError(null);
    try {
      const { prepareImageEditOutpaintV3, startImageEditOutpaintV3 } = await loadOutpaint();
      const request = { documentId, margins: { left: left / 100, top: top / 100, right: right / 100, bottom: bottom / 100 }, prompt: toPromptPlainText(prompt) || text('defaultPrompt'), ...(modelId ? { modelId } : {}) };
      const prepared = await prepareImageEditOutpaintV3(request);
      const price = prepared.preparation.priceEstimate as { amount?: number; currency?: string } | null;
      const settings = readPriceEstimateDisplaySettings();
      const estimate = price && typeof price.amount === 'number' && typeof price.currency === 'string'
        ? formatPriceEstimate({ amount: price.amount, sourceCurrencySymbol: price.currency, displayCurrencyMode: settings.currencyMode,
          language: i18n.resolvedLanguage ?? i18n.language, usdToCnyRate: settings.usdToCnyRate }).display : '';
      const name = getI18nText(registry.getModel(prepared.modelId)?.meta.name ?? prepared.modelId, i18n.language);
      setOpen(false);
      if (!await requestAlertConfirmation({ title: text('confirmTitle'), type: 'warning', message: `${name} ${estimate}\n${text('cost')}`, confirmLabel: text('confirm') })) { setOpen(true); return; }
      await startImageEditOutpaintV3({ ...request, modelId: prepared.modelId, params: prepared.params });
      setOpen(false);
    } catch (failure) {
      if (!(failure instanceof Error && failure.name === 'AbortError')) { setOpen(true); setError(failure instanceof Error ? failure.message : String(failure)); }
    }
    finally { setBusy(false); }
  };
  return <>
    <UiButton size="sm" disabled={active} onClick={() => setOpen(true)}>{text('configure')}</UiButton>
    <span className="text-xs text-text3">{text('costShort')}</span>
    <UiModal isOpen={open} title={text('title')} onClose={() => { if (!busy) setOpen(false); }} size="compact"
      footer={<><UiButton disabled={busy} onClick={() => setOpen(false)}>{text('close')}</UiButton><UiButton variant="primary" disabled={busy || active || left + top + right + bottom <= 0} onClick={() => void begin()}>{text('generate')}</UiButton></>}>
      <div className="flex flex-col gap-4" data-outpaint-configuration>
        <p className="text-sm text-text2">{text('description')}</p>
        <UiFormRow label={text('left')}><NumberInput ariaLabel={text('left')} value={left} min={0} onChange={setLeft} disabled={busy} /></UiFormRow>
        <UiFormRow label={text('top')}><NumberInput ariaLabel={text('top')} value={top} min={0} onChange={setTop} disabled={busy} /></UiFormRow>
        <UiFormRow label={text('right')}><NumberInput ariaLabel={text('right')} value={right} min={0} onChange={setRight} disabled={busy} /></UiFormRow>
        <UiFormRow label={text('bottom')}><NumberInput ariaLabel={text('bottom')} value={bottom} min={0} onChange={setBottom} disabled={busy} /></UiFormRow>
        <UiButton disabled={busy} title={text('changeModel')} onClick={() => setPicking(true)}>{modelId ? getI18nText(registry.getModel(modelId)?.meta.name ?? modelId, i18n.language) : text('defaultModel')}</UiButton>
        <PromptEditor preset="plain" value={prompt} onChange={setPrompt} ariaLabel={text('prompt')} placeholder={text('defaultPrompt')} disabled={busy} />
        <p className="text-xs text-text3">{text('cost')}</p>
        {busy ? <UiLoading size="xs" message={text('preparing')} /> : error ? <UiError size="xs" message={error} /> : <UiEmpty size="xs" title={text('empty')} />}
      </div>
    </UiModal>
    <UiModal isOpen={picking} title={text('modelTitle')} onClose={() => setPicking(false)} size="editor">
      <ModelSelectorPanel selectedModel={modelId} selectedProvider={providerId} modelFilterProvider={filterProvider} modelFilterType={filterType} modelFilterFunction={filterFunction} favoriteModels={favorites}
        onModelSelect={(provider, model) => { setProviderId(provider); setModelId(model); setPicking(false); }}
        onFilterProviderChange={setFilterProvider} onFilterTypeChange={setFilterType} onFilterFunctionChange={setFilterFunction}
        onToggleFavorite={(_event, provider, model) => setFavorites(previous => { const next = new Set(previous), key = `${provider}:${model}`; if (next.has(key)) next.delete(key); else next.add(key); return next; })} />
    </UiModal>
  </>;
}
