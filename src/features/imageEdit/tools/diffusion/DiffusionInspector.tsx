import { useId, useMemo, useState, type PointerEvent } from 'react';
import { ChevronDown, RotateCcw, Trash2 } from 'lucide-react';
import {
  applyDiffusionPreset,
  createDefaultDiffusionOperationParams,
  getDiffusionPreset,
  IMAGE_EDIT_OPERATION_IDS,
  listDiffusionPresets,
  type DiffusionOperationParams,
} from '@/core/imageEdit';
import {
  Dropdown,
  UI_TEXT_META_CLASS,
  UI_TEXT_SECTION_CLASS,
  UiChipButton,
  UiRangeInput,
  UiSwitch,
} from '@/components/ui';
import { useImageEditorDocumentController } from '@/features/imageEdit/editor/ImageEditorDocumentContext';
import { useI18n } from '@/hooks/useI18n';
import {
  DIFFUSION_DENSITY_OPTIONS,
  DIFFUSION_MODE_OPTIONS,
  DIFFUSION_QUALITY_OPTIONS,
  type DiffusionSelectOption,
  formatDiffusionNumber,
  formatDiffusionPercent,
  formatDiffusionRadius,
} from './diffusionUiMapping';

interface RangeFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
  onBegin: () => void;
  onCommit: () => void;
  onCancel: () => void;
}

interface DiffusionSectionProps {
  title: string;
  children: React.ReactNode;
}

interface DiffusionDropdownFieldProps<T extends string> {
  label: string;
  value: T;
  options: readonly DiffusionSelectOption<T>[];
  onChange: (value: T) => void;
}

function DiffusionDropdownField<T extends string>({
  label,
  value,
  options,
  onChange,
}: DiffusionDropdownFieldProps<T>): JSX.Element {
  const labelId = useId();
  return (
    <div className={`space-y-1.5 ${UI_TEXT_META_CLASS}`}>
      <span id={labelId}>{label}</span>
      <Dropdown<T>
        value={value}
        options={options.map((option) => ({ ...option }))}
        onSelect={onChange}
        ariaLabelledBy={labelId}
        className="w-full"
        buttonClassName="w-full"
        minWidthStrategy="none"
        panelWidthStrategy="button"
      />
    </div>
  );
}

function DiffusionRangeField({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
  onBegin,
  onCommit,
  onCancel,
}: RangeFieldProps): JSX.Element {
  const handlePointerUp = (_event: PointerEvent<HTMLInputElement>): void => onCommit();
  return (
    <label className="block space-y-1.5">
      <span className={`flex items-center justify-between gap-3 ${UI_TEXT_META_CLASS}`}>
        <span>{label}</span>
        <span className="shrink-0 text-text-dark">{display}</span>
      </span>
      <UiRangeInput
        value={value}
        min={min}
        max={max}
        step={step}
        onFocus={onBegin}
        onPointerDown={onBegin}
        onPointerUp={handlePointerUp}
        onPointerCancel={onCancel}
        onBlur={onCommit}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  );
}

function DiffusionSection({ title, children }: DiffusionSectionProps): JSX.Element {
  const [open, setOpen] = useState(true);
  const contentId = useId();
  return (
    <section className="border-b border-border-dark py-3 last:border-b-0">
      <UiChipButton
        type="button"
        className="!h-7 w-full justify-between !border-0 !bg-transparent !px-0 !text-xs"
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
        aria-controls={contentId}
      >
        {title}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? '' : '-rotate-90'}`} />
      </UiChipButton>
      {open ? <div id={contentId} className="space-y-3 pt-3">{children}</div> : null}
    </section>
  );
}

export function DiffusionInspector(): JSX.Element {
  const controller = useImageEditorDocumentController();
  const { t, tText } = useI18n('ui');
  const operation = controller.getOperation<DiffusionOperationParams>(IMAGE_EDIT_OPERATION_IDS.diffusion);
  const params = operation?.params ?? createDefaultDiffusionOperationParams();
  const presets = useMemo(() => listDiffusionPresets(), []);
  const selectedPreset = params.presetId
    ? getDiffusionPreset(params.presetId)
    : undefined;
  const previewState = controller.previewState;
  const previewStatus = resolvePreviewStatus(previewState, t);

  const update = (patch: (current: DiffusionOperationParams) => DiffusionOperationParams): void => {
    controller.updateOperation<DiffusionOperationParams>(IMAGE_EDIT_OPERATION_IDS.diffusion, patch);
  };
  const beginRange = (): void => controller.beginTransaction();
  const commitRange = (): void => controller.commitTransaction();
  const cancelRange = (): void => controller.cancelTransaction();
  const setEnabled = (enabled: boolean): void => controller.setOperationEnabled(IMAGE_EDIT_OPERATION_IDS.diffusion, enabled);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className={UI_TEXT_SECTION_CLASS}>{t('imageEditor.diffusion.tool')}</h2>
          <p className={`mt-1 leading-5 ${UI_TEXT_META_CLASS}`}>{t('imageEditor.diffusion.description')}</p>
        </div>
        <UiSwitch checked={operation?.enabled ?? false} onCheckedChange={setEnabled} aria-label={t('imageEditor.diffusion.enable')} />
      </div>
      {previewState && previewState.phase !== 'idle' ? (
        <div role="status" aria-live="polite" className={`mb-3 rounded-lg border px-2.5 py-2 text-xs ${previewState.phase === 'failed' ? 'border-red-500/40 text-red-300' : 'border-border-dark text-text-muted'}`}>
          {previewStatus}
        </div>
      ) : previewState?.backend ? <div className={`mb-3 ${UI_TEXT_META_CLASS}`}>{t('imageEditor.diffusion.previewBackend')}：{previewState.backend === 'webgpu-worker' ? 'WebGPU' : previewState.backend}</div> : null}

      <fieldset disabled={!operation?.enabled} className="m-0 min-w-0 space-y-3 border-0 p-0 disabled:opacity-60">
        <DiffusionDropdownField
          label="模式"
          value={params.mode}
          options={DIFFUSION_MODE_OPTIONS}
          onChange={(mode) => update((current) => ({ ...current, mode, presetId: null }))}
        />
        <div className={`space-y-1.5 ${UI_TEXT_META_CLASS}`}>
          <DiffusionDropdownField
            label={t('imageEditor.diffusion.preset.label')}
            value={params.presetId ?? ''}
            options={[
              { value: '', label: t('imageEditor.diffusion.preset.custom') },
              ...presets.map((preset) => ({ value: preset.id, label: tText(preset.name) })),
            ]}
            onChange={(presetId) => {
              if (!presetId) update((current) => ({ ...current, presetId: null }));
              else update(() => applyDiffusionPreset(presetId as Parameters<typeof applyDiffusionPreset>[0]));
            }}
          />
          {selectedPreset ? <span className="block leading-5 text-text-muted">{tText(selectedPreset.description)}</span> : null}
        </div>
        <p className={`-mt-1 leading-5 ${UI_TEXT_META_CLASS}`}>{t('imageEditor.diffusion.preset.sourceNotice')}</p>
        <div className="grid grid-cols-2 gap-2">
          <DiffusionDropdownField label="档位" value={params.density} options={DIFFUSION_DENSITY_OPTIONS} onChange={(density) => update((current) => ({ ...current, density }))} />
          <DiffusionDropdownField label="质量" value={params.quality} options={DIFFUSION_QUALITY_OPTIONS} onChange={(quality) => update((current) => ({ ...current, quality }))} />
        </div>
        <DiffusionRangeField label="强度" value={params.strength} min={0} max={1} step={0.01} display={formatDiffusionPercent(params.strength)} onChange={(value) => update((current) => ({ ...current, strength: value, presetId: null }))} onBegin={beginRange} onCommit={commitRange} onCancel={cancelRange} />

        <DiffusionSection title="光源">
          <DiffusionRangeField label="阈值 EV" value={params.source.thresholdEV} min={-8} max={8} step={0.1} display={formatDiffusionNumber(params.source.thresholdEV, 1)} onChange={(value) => update((current) => ({ ...current, presetId: null, source: { ...current.source, thresholdEV: value } }))} onBegin={beginRange} onCommit={commitRange} onCancel={cancelRange} />
          <DiffusionRangeField label="柔化拐点" value={params.source.softKneeEV} min={0} max={8} step={0.1} display={formatDiffusionNumber(params.source.softKneeEV, 1)} onChange={(value) => update((current) => ({ ...current, presetId: null, source: { ...current.source, softKneeEV: value } }))} onBegin={beginRange} onCommit={commitRange} onCancel={cancelRange} />
          <DiffusionRangeField label="响应幂值" value={params.source.power} min={0.1} max={8} step={0.1} display={formatDiffusionNumber(params.source.power, 1)} onChange={(value) => update((current) => ({ ...current, presetId: null, source: { ...current.source, power: value } }))} onBegin={beginRange} onCommit={commitRange} onCancel={cancelRange} />
          <DiffusionRangeField label="高光恢复" value={params.source.highlightRecovery} min={0} max={1} step={0.01} display={formatDiffusionPercent(params.source.highlightRecovery)} onChange={(value) => update((current) => ({ ...current, presetId: null, source: { ...current.source, highlightRecovery: value } }))} onBegin={beginRange} onCommit={commitRange} onCancel={cancelRange} />
        </DiffusionSection>

        <DiffusionSection title="散射">
          <DiffusionRangeField label="高光散射" value={params.scatter.highlightAmount} min={0} max={1} step={0.01} display={formatDiffusionPercent(params.scatter.highlightAmount)} onChange={(value) => update((current) => ({ ...current, presetId: null, scatter: { ...current.scatter, highlightAmount: value } }))} onBegin={beginRange} onCommit={commitRange} onCancel={cancelRange} />
          <DiffusionRangeField label="微扩散" value={params.scatter.microAmount} min={0} max={1} step={0.001} display={formatDiffusionPercent(params.scatter.microAmount)} onChange={(value) => update((current) => ({ ...current, presetId: null, scatter: { ...current.scatter, microAmount: value } }))} onBegin={beginRange} onCommit={commitRange} onCancel={cancelRange} />
          <DiffusionRangeField label="近距半径" value={params.scatter.nearRadius} min={0} max={params.scatter.farRadius} step={0.001} display={formatDiffusionRadius(params.scatter.nearRadius)} onChange={(value) => update((current) => ({ ...current, presetId: null, scatter: { ...current.scatter, nearRadius: value } }))} onBegin={beginRange} onCommit={commitRange} onCancel={cancelRange} />
          <DiffusionRangeField label="远距半径" value={params.scatter.farRadius} min={params.scatter.nearRadius} max={1} step={0.001} display={formatDiffusionRadius(params.scatter.farRadius)} onChange={(value) => update((current) => ({ ...current, presetId: null, scatter: { ...current.scatter, farRadius: value } }))} onBegin={beginRange} onCommit={commitRange} onCancel={cancelRange} />
          <DiffusionRangeField label="长尾" value={params.scatter.tailAmount} min={0} max={1} step={0.01} display={formatDiffusionPercent(params.scatter.tailAmount)} onChange={(value) => update((current) => ({ ...current, presetId: null, scatter: { ...current.scatter, tailAmount: value } }))} onBegin={beginRange} onCommit={commitRange} onCancel={cancelRange} />
          <DiffusionRangeField label="长尾形状" value={params.scatter.tailShape} min={1} max={16} step={0.1} display={formatDiffusionNumber(params.scatter.tailShape, 1)} onChange={(value) => update((current) => ({ ...current, presetId: null, scatter: { ...current.scatter, tailShape: value } }))} onBegin={beginRange} onCommit={commitRange} onCancel={cancelRange} />
          <DiffusionRangeField label="各向异性" value={params.scatter.anisotropy} min={0} max={1} step={0.01} display={formatDiffusionPercent(params.scatter.anisotropy)} onChange={(value) => update((current) => ({ ...current, presetId: null, scatter: { ...current.scatter, anisotropy: value } }))} onBegin={beginRange} onCommit={commitRange} onCancel={cancelRange} />
          <DiffusionRangeField label="散射角度" value={params.scatter.angle} min={-360} max={360} step={1} display={`${Math.round(params.scatter.angle)}°`} onChange={(value) => update((current) => ({ ...current, presetId: null, scatter: { ...current.scatter, angle: value } }))} onBegin={beginRange} onCommit={commitRange} onCancel={cancelRange} />
          <DiffusionRangeField label="色散" value={params.scatter.chromaticSpread} min={0} max={0.25} step={0.001} display={formatDiffusionRadius(params.scatter.chromaticSpread)} onChange={(value) => update((current) => ({ ...current, presetId: null, scatter: { ...current.scatter, chromaticSpread: value } }))} onBegin={beginRange} onCommit={commitRange} onCancel={cancelRange} />
        </DiffusionSection>

        <DiffusionSection title="色调">
          <DiffusionRangeField label="雾幕" value={params.tone.veil} min={0} max={1} step={0.001} display={formatDiffusionPercent(params.tone.veil)} onChange={(value) => update((current) => ({ ...current, presetId: null, tone: { ...current.tone, veil: value } }))} onBegin={beginRange} onCommit={commitRange} onCancel={cancelRange} />
          <DiffusionRangeField label="黑位保留" value={params.tone.blackRetention} min={0} max={1} step={0.01} display={formatDiffusionPercent(params.tone.blackRetention)} onChange={(value) => update((current) => ({ ...current, presetId: null, tone: { ...current.tone, blackRetention: value } }))} onBegin={beginRange} onCommit={commitRange} onCancel={cancelRange} />
          <DiffusionRangeField label="高光压缩" value={params.tone.highlightCompression} min={0} max={1} step={0.01} display={formatDiffusionPercent(params.tone.highlightCompression)} onChange={(value) => update((current) => ({ ...current, presetId: null, tone: { ...current.tone, highlightCompression: value } }))} onBegin={beginRange} onCommit={commitRange} onCancel={cancelRange} />
          <DiffusionRangeField label="散射去饱和" value={params.tone.scatterDesaturation} min={0} max={1} step={0.01} display={formatDiffusionPercent(params.tone.scatterDesaturation)} onChange={(value) => update((current) => ({ ...current, presetId: null, tone: { ...current.tone, scatterDesaturation: value } }))} onBegin={beginRange} onCommit={commitRange} onCancel={cancelRange} />
        </DiffusionSection>

        <DiffusionSection title="细节">
          <DiffusionRangeField label="高频保留" value={params.detail.highFrequencyRetention} min={0} max={1} step={0.01} display={formatDiffusionPercent(params.detail.highFrequencyRetention)} onChange={(value) => update((current) => ({ ...current, presetId: null, detail: { ...current.detail, highFrequencyRetention: value } }))} onBegin={beginRange} onCommit={commitRange} onCancel={cancelRange} />
          <DiffusionRangeField label="中频保留" value={params.detail.midFrequencyRetention} min={0} max={1} step={0.01} display={formatDiffusionPercent(params.detail.midFrequencyRetention)} onChange={(value) => update((current) => ({ ...current, presetId: null, detail: { ...current.detail, midFrequencyRetention: value } }))} onBegin={beginRange} onCommit={commitRange} onCancel={cancelRange} />
        </DiffusionSection>

        <DiffusionSection title="镜头">
          <DiffusionRangeField label="等效焦距" value={params.lens.focalLengthEq} min={1} max={1000} step={1} display={`${Math.round(params.lens.focalLengthEq)} mm`} onChange={(value) => update((current) => ({ ...current, presetId: null, lens: { ...current.lens, focalLengthEq: value } }))} onBegin={beginRange} onCommit={commitRange} onCancel={cancelRange} />
          <DiffusionRangeField label="光圈" value={params.lens.aperture} min={0.1} max={64} step={0.1} display={`f/${formatDiffusionNumber(params.lens.aperture, 1)}`} onChange={(value) => update((current) => ({ ...current, presetId: null, lens: { ...current.lens, aperture: value } }))} onBegin={beginRange} onCommit={commitRange} onCancel={cancelRange} />
          <DiffusionRangeField label="位置变化" value={params.lens.positionVariation} min={0} max={1} step={0.01} display={formatDiffusionPercent(params.lens.positionVariation)} onChange={(value) => update((current) => ({ ...current, presetId: null, lens: { ...current.lens, positionVariation: value } }))} onBegin={beginRange} onCommit={commitRange} onCancel={cancelRange} />
        </DiffusionSection>
      </fieldset>

      <div className="mt-3 flex gap-2">
        <UiChipButton type="button" className="!h-8 flex-1 !justify-center !text-xs" onClick={() => controller.resetOperation(IMAGE_EDIT_OPERATION_IDS.diffusion)}><RotateCcw className="h-3.5 w-3.5" />{t('imageEditor.diffusion.reset')}</UiChipButton>
        <UiChipButton type="button" className="!h-8 flex-1 !justify-center !text-xs" disabled={!operation} onClick={() => controller.removeOperation(IMAGE_EDIT_OPERATION_IDS.diffusion)}><Trash2 className="h-3.5 w-3.5" />{t('imageEditor.diffusion.remove')}</UiChipButton>
      </div>
    </div>
  );
}

function resolvePreviewStatus(
  previewState: ReturnType<typeof useImageEditorDocumentController>['previewState'],
  t: ReturnType<typeof useI18n>['t']
): string | undefined {
  if (previewState?.phase === 'compiling') return t('imageEditor.diffusion.compiling');
  if (previewState?.phase === 'rendering') return t('imageEditor.diffusion.rendering');
  if (previewState?.phase !== 'degraded') return previewState?.message;
  if (previewState.fallbackReason === 'webgpu-api-unavailable') {
    return t('imageEditor.diffusion.sharpFallbackApiUnavailable');
  }
  if (previewState.fallbackReason === 'webgpu-adapter-unavailable') {
    return t('imageEditor.diffusion.sharpFallbackAdapterUnavailable');
  }
  if (previewState.fallbackReason === 'webgpu-device-recovery-exhausted') {
    return t('imageEditor.diffusion.sharpFallbackRecoveryExhausted');
  }
  return t('imageEditor.diffusion.sharpFallbackInitializationFailed');
}
