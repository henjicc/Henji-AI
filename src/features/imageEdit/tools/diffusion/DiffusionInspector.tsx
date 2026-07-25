import { useMemo, useState, type PointerEvent } from 'react';
import { ChevronDown, RotateCcw, Trash2 } from 'lucide-react';
import {
  applyDiffusionPreset,
  createDefaultDiffusionOperationParams,
  IMAGE_EDIT_OPERATION_IDS,
  listDiffusionPresets,
  type DiffusionOperationParams,
} from '@/core/imageEdit';
import { UiChipButton, UiRangeInput, UiSelect, UiSwitch } from '@/components/ui';
import { useImageEditorDocumentController } from '@/features/imageEdit/editor/ImageEditorDocumentContext';
import { useI18n } from '@/hooks/useI18n';
import {
  DIFFUSION_DENSITY_OPTIONS,
  DIFFUSION_MODE_OPTIONS,
  DIFFUSION_QUALITY_OPTIONS,
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
      <span className="flex items-center justify-between gap-3 text-xs text-text-muted">
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
  return (
    <section className="border-b border-border-dark py-3 last:border-b-0">
      <UiChipButton
        type="button"
        className="!h-7 w-full justify-between !border-0 !bg-transparent !px-0 !text-xs"
        onClick={() => setOpen((previous) => !previous)}
      >
        {title}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? '' : '-rotate-90'}`} />
      </UiChipButton>
      {open ? <div className="space-y-3 pt-3">{children}</div> : null}
    </section>
  );
}

export function DiffusionInspector(): JSX.Element {
  const controller = useImageEditorDocumentController();
  const { t } = useI18n('ui');
  const operation = controller.getOperation<DiffusionOperationParams>(IMAGE_EDIT_OPERATION_IDS.diffusion);
  const params = operation?.params ?? createDefaultDiffusionOperationParams();
  const presets = useMemo(() => listDiffusionPresets(), []);
  const previewState = controller.previewState;
  const previewStatus = previewState?.phase === 'compiling'
    ? t('imageEditor.diffusion.compiling')
    : previewState?.phase === 'rendering'
      ? t('imageEditor.diffusion.rendering')
      : previewState?.message;

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
          <h2 className="text-sm font-semibold text-text-dark">{t('imageEditor.diffusion.tool')}</h2>
          <p className="mt-1 text-xs leading-5 text-text-muted">{t('imageEditor.diffusion.description')}</p>
        </div>
        <UiSwitch checked={operation?.enabled ?? false} onCheckedChange={setEnabled} aria-label={t('imageEditor.diffusion.enable')} />
      </div>
      {previewState && previewState.phase !== 'idle' ? (
        <div className={`mb-3 rounded-lg border px-2.5 py-2 text-xs ${previewState.phase === 'failed' ? 'border-red-500/40 text-red-300' : 'border-border-dark text-text-muted'}`}>
          {previewStatus}
        </div>
      ) : previewState?.backend ? <div className="mb-3 text-xs text-text-muted">{t('imageEditor.diffusion.previewBackend')}：{previewState.backend === 'webgpu-worker' ? 'WebGPU' : previewState.backend}</div> : null}

      <div className={`space-y-3 ${operation?.enabled ? '' : 'pointer-events-none opacity-60'}`}>
        <label className="block space-y-1.5 text-xs text-text-muted">
          <span>模式</span>
          <UiSelect
            value={params.mode}
            onChange={(event) => update((current) => ({ ...current, mode: event.currentTarget.value as DiffusionOperationParams['mode'], presetId: null }))}
          >
            {DIFFUSION_MODE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </UiSelect>
        </label>
        <label className="block space-y-1.5 text-xs text-text-muted">
          <span>通用预设</span>
          <UiSelect
            value={params.presetId ?? ''}
            onChange={(event) => {
              const presetId = event.currentTarget.value;
              if (!presetId) update((current) => ({ ...current, presetId: null }));
              else update(() => applyDiffusionPreset(presetId as Parameters<typeof applyDiffusionPreset>[0]));
            }}
          >
            <option value="">自定义</option>
            {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.id === 'black-mist-soft' ? '通用黑柔' : preset.id === 'white-mist-soft' ? '通用白柔' : '通用辉光'}</option>)}
          </UiSelect>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1.5 text-xs text-text-muted"><span>档位</span><UiSelect value={params.density} onChange={(event) => update((current) => ({ ...current, density: event.currentTarget.value as DiffusionOperationParams['density'] }))}>{DIFFUSION_DENSITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</UiSelect></label>
          <label className="space-y-1.5 text-xs text-text-muted"><span>质量</span><UiSelect value={params.quality} onChange={(event) => update((current) => ({ ...current, quality: event.currentTarget.value as DiffusionOperationParams['quality'] }))}>{DIFFUSION_QUALITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</UiSelect></label>
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
      </div>

      <div className="mt-3 flex gap-2">
        <UiChipButton type="button" className="!h-8 flex-1 !justify-center !text-xs" onClick={() => controller.resetOperation(IMAGE_EDIT_OPERATION_IDS.diffusion)}><RotateCcw className="h-3.5 w-3.5" />{t('imageEditor.diffusion.reset')}</UiChipButton>
        <UiChipButton type="button" className="!h-8 flex-1 !justify-center !text-xs" disabled={!operation} onClick={() => controller.removeOperation(IMAGE_EDIT_OPERATION_IDS.diffusion)}><Trash2 className="h-3.5 w-3.5" />{t('imageEditor.diffusion.remove')}</UiChipButton>
      </div>
    </div>
  );
}
