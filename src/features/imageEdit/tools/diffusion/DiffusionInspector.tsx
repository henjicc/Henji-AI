import type { PointerEvent } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import {
  applyDiffusionPresetForSelection,
  createDefaultDiffusionOperationParams,
  IMAGE_EDIT_OPERATION_IDS,
  type DiffusionDensity,
  type DiffusionMode,
  type DiffusionOperationParams,
  type DiffusionQuality,
} from '@/core/imageEdit';
import {
  UI_TEXT_META_CLASS,
  UI_TEXT_SECTION_CLASS,
  UiChipButton,
  UiGroup,
  UiOptionButton,
  UiRangeInput,
  UiSwitch,
  type UiRangeTrackTone,
} from '@/components/ui';
import { useImageEditorDocumentController } from '@/features/imageEdit/editor/ImageEditorDocumentContext';
import { useI18n } from '@/hooks/useI18n';
import {
  DIFFUSION_MODE_OPTIONS,
  DIFFUSION_QUALITY_OPTIONS,
  formatDiffusionDegrees,
  formatDiffusionPercent,
  formatDiffusionSigned,
  getDiffusionDensityOptions,
  type DiffusionSelectOption,
} from './diffusionUiMapping';

interface RangeFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  trackTone?: UiRangeTrackTone;
  onChange: (value: number) => void;
  onBegin: () => void;
  onCommit: () => void;
  onCancel: () => void;
}

function DiffusionRangeField({
  label,
  value,
  min,
  max,
  step,
  display,
  trackTone,
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
        trackTone={trackTone}
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

interface SegmentedFieldProps<T extends string> {
  label: string;
  value: T;
  options: readonly DiffusionSelectOption<T>[];
  onChange: (value: T) => void;
}

/**
 * 同质选项集合，且外层面板已经画过一次边界，因此静息态不描边（见 skill henji-ui-surface
 * 的「选项集合的静息态」）。
 */
function DiffusionSegmentedField<T extends string>({
  label,
  value,
  options,
  onChange,
}: SegmentedFieldProps<T>): JSX.Element {
  return (
    <div className="space-y-1.5">
      <span className={UI_TEXT_META_CLASS}>{label}</span>
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map((option) => (
          <UiOptionButton
            key={option.value}
            type="button"
            variant="menu"
            active={option.value === value}
            className="justify-center text-xs"
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </UiOptionButton>
        ))}
      </div>
    </div>
  );
}

export function DiffusionInspector(): JSX.Element {
  const controller = useImageEditorDocumentController();
  const { t } = useI18n('ui');
  const operation = controller.getOperation<DiffusionOperationParams>(IMAGE_EDIT_OPERATION_IDS.diffusion);
  const params = operation?.params ?? createDefaultDiffusionOperationParams();
  const update = (patch: (current: DiffusionOperationParams) => DiffusionOperationParams): void => {
    controller.updateOperation<DiffusionOperationParams>(IMAGE_EDIT_OPERATION_IDS.diffusion, patch);
  };
  const beginRange = (): void => controller.beginTransaction();
  const commitRange = (): void => controller.commitTransaction();
  const cancelRange = (): void => controller.cancelTransaction();
  const setEnabled = (enabled: boolean): void =>
    controller.setOperationEnabled(IMAGE_EDIT_OPERATION_IDS.diffusion, enabled);

  // 同一组数值在黑柔和辉光下观感差别很大，切换模式/档位时套用对应基准，
  // 而不是把上一模式的数值原样留着。
  const selectMode = (mode: DiffusionMode): void =>
    update((current) => applyDiffusionPresetForSelection(current, mode, current.density));
  const selectDensity = (density: DiffusionDensity): void =>
    update((current) => applyDiffusionPresetForSelection(current, current.mode, density));

  const setUnit = (
    key: 'strength' | 'glowRange' | 'highlightResponse' | 'softness'
      | 'blackRetention' | 'detailRetention' | 'colorRetention'
      | 'glowExposure' | 'highlightRolloff' | 'glowCoreWhite'
  ) => (value: number): void => update((current) => ({ ...current, [key]: value }));

  const setTint = (patch: Partial<DiffusionOperationParams['tint']>): void =>
    update((current) => ({ ...current, tint: { ...current.tint, ...patch } }));

  const rangeHandlers = { onBegin: beginRange, onCommit: commitRange, onCancel: cancelRange };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
      <div className="mb-3 flex items-start justify-between gap-2">
        <h2 className={UI_TEXT_SECTION_CLASS}>{t('imageEditor.diffusion.tool')}</h2>
        <UiSwitch
          checked={operation?.enabled ?? false}
          onCheckedChange={setEnabled}
          aria-label={t('imageEditor.diffusion.enable')}
        />
      </div>
      <fieldset disabled={!operation?.enabled} className="m-0 min-w-0 space-y-4 border-0 p-0 disabled:opacity-60">
        <UiGroup gap="row">
          <DiffusionSegmentedField
            label="模式"
            value={params.mode}
            options={DIFFUSION_MODE_OPTIONS}
            onChange={selectMode}
          />
          <DiffusionSegmentedField
            label="档位"
            value={params.density}
            options={getDiffusionDensityOptions(params.mode)}
            onChange={selectDensity}
          />
        </UiGroup>

        <UiGroup gap="row" divided>
          <DiffusionRangeField
            label="强度" value={params.strength} min={0} max={1} step={0.01}
            display={formatDiffusionPercent(params.strength)}
            onChange={setUnit('strength')} {...rangeHandlers}
          />
          <DiffusionRangeField
            label="辉光范围" value={params.glowRange} min={0} max={1} step={0.01}
            display={formatDiffusionPercent(params.glowRange)}
            onChange={setUnit('glowRange')} {...rangeHandlers}
          />
          <DiffusionRangeField
            label="高光响应" value={params.highlightResponse} min={0} max={1} step={0.01}
            display={formatDiffusionPercent(params.highlightResponse)}
            onChange={setUnit('highlightResponse')} {...rangeHandlers}
          />
          <DiffusionRangeField
            label="光斑柔和度" value={params.softness} min={0} max={1} step={0.01}
            display={formatDiffusionPercent(params.softness)}
            onChange={setUnit('softness')} {...rangeHandlers}
          />
          {/* 摄影柔光走能量守恒，没有「曝光」可言；只有辉光允许把光源推到过曝。 */}
          {params.mode === 'glow' ? (
            <DiffusionRangeField
              label="辉光曝光" value={params.glowExposure} min={0} max={1} step={0.01}
              display={formatDiffusionPercent(params.glowExposure)}
              onChange={setUnit('glowExposure')} {...rangeHandlers}
            />
          ) : null}
          {/* 黑柔/白柔的高光肩部由模式派生，拉出来会让两种模式退化成强弱差别。 */}
          {params.mode === 'glow' ? (
            <DiffusionRangeField
              label="高光滚降" value={params.highlightRolloff} min={0} max={1} step={0.01}
              display={formatDiffusionPercent(params.highlightRolloff)}
              onChange={setUnit('highlightRolloff')} {...rangeHandlers}
            />
          ) : null}
          {/* 真实感控制不是染色控制：彩色光源的核心本来就该是过曝的白，
              所以放在主参数里，不跟着「着色」开关走。 */}
          {params.mode === 'glow' ? (
            <DiffusionRangeField
              label="核心白热" value={params.glowCoreWhite} min={0} max={1} step={0.01}
              display={formatDiffusionPercent(params.glowCoreWhite)}
              onChange={setUnit('glowCoreWhite')} {...rangeHandlers}
            />
          ) : null}
          {/* 辉光不主动抬黑位，没有需要「保持」的东西，滑块在该模式下会是死的，故不显示。 */}
          {params.mode === 'glow' ? null : (
            <DiffusionRangeField
              label="黑位保持" value={params.blackRetention} min={0} max={1} step={0.01}
              display={formatDiffusionPercent(params.blackRetention)}
              onChange={setUnit('blackRetention')} {...rangeHandlers}
            />
          )}
          {/* 数字 Bloom 保留原底图并叠加光晕，不会软化底图细节。 */}
          {params.mode === 'glow' ? null : (
            <DiffusionRangeField
              label="细节保留" value={params.detailRetention} min={0} max={1} step={0.01}
              display={formatDiffusionPercent(params.detailRetention)}
              onChange={setUnit('detailRetention')} {...rangeHandlers}
            />
          )}
          <DiffusionRangeField
            label="色彩保持" value={params.colorRetention} min={0} max={1} step={0.01}
            display={formatDiffusionPercent(params.colorRetention)}
            onChange={setUnit('colorRetention')} {...rangeHandlers}
          />
        </UiGroup>

        <UiGroup
          divided
          gap="row"
          title="着色"
          titleTone="overline"
          actions={
            <UiSwitch
              checked={params.tint.enabled}
              onCheckedChange={(enabled) => setTint({ enabled })}
              aria-label="启用着色"
            />
          }
        >
          {params.tint.enabled ? (
            <>
              <DiffusionRangeField
                label="色相" value={params.tint.hue} min={0} max={360} step={1}
                display={formatDiffusionDegrees(params.tint.hue)}
                trackTone="hue"
                onChange={(hue) => setTint({ hue })} {...rangeHandlers}
              />
              <DiffusionRangeField
                label="饱和度" value={params.tint.saturation} min={0} max={1} step={0.01}
                display={formatDiffusionPercent(params.tint.saturation)}
                onChange={(saturation) => setTint({ saturation })} {...rangeHandlers}
              />
              <DiffusionRangeField
                label="亮度" value={params.tint.lightness} min={-1} max={1} step={0.01}
                display={formatDiffusionSigned(params.tint.lightness)}
                onChange={(lightness) => setTint({ lightness })} {...rangeHandlers}
              />
            </>
          ) : null}
        </UiGroup>

        <UiGroup gap="row" divided>
          <DiffusionSegmentedField
            label="质量"
            value={params.quality}
            options={DIFFUSION_QUALITY_OPTIONS}
            onChange={(quality: DiffusionQuality) => update((current) => ({ ...current, quality }))}
          />
        </UiGroup>
      </fieldset>

      <div className="mt-4 flex gap-2">
        <UiChipButton
          type="button"
          className="!h-8 flex-1 !justify-center !text-xs"
          onClick={() => controller.resetOperation(IMAGE_EDIT_OPERATION_IDS.diffusion)}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {t('imageEditor.diffusion.reset')}
        </UiChipButton>
        <UiChipButton
          type="button"
          className="!h-8 flex-1 !justify-center !text-xs"
          disabled={!operation}
          onClick={() => controller.removeOperation(IMAGE_EDIT_OPERATION_IDS.diffusion)}
        >
          <Trash2 className="h-3.5 w-3.5" />
          {t('imageEditor.diffusion.remove')}
        </UiChipButton>
      </div>
    </div>
  );
}
