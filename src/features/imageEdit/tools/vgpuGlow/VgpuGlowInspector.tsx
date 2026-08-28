import type { PointerEvent } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import {
  applyVgpuGlowLook,
  createDefaultVgpuGlowOperationParams,
  IMAGE_EDIT_OPERATION_IDS,
  type VgpuGlowLook,
  type VgpuGlowOperationParams,
} from '@/core/imageEdit';
import {
  UI_TEXT_META_CLASS,
  UI_TEXT_SECTION_CLASS,
  UiChipButton,
  UiColorInput,
  UiError,
  UiFormRow,
  UiGroup,
  UiOptionButton,
  UiRangeInput,
  UiSwitch,
} from '@/components/ui';
import { useImageEditorDocumentController } from '@/features/imageEdit/editor/ImageEditorDocumentContext';

const LOOK_OPTIONS: readonly { value: VgpuGlowLook; label: string; detail: string }[] = [
  { value: 'natural', label: '自然', detail: '克制、保留原图质感' },
  { value: 'dreamy', label: '梦幻', detail: '柔软、远场光晕更明显' },
  { value: 'neon', label: '霓虹', detail: '明亮、彩色光源更有冲击力' },
];

interface RangeFieldProps {
  label: string;
  value: number;
  info: string;
  onChange: (value: number) => void;
  onBegin: () => void;
  onCommit: () => void;
  onCancel: () => void;
}

function GlowRangeField({
  label,
  value,
  info,
  onChange,
  onBegin,
  onCommit,
  onCancel,
}: RangeFieldProps): JSX.Element {
  const handlePointerUp = (_event: PointerEvent<HTMLInputElement>): void => onCommit();
  return (
    <UiFormRow label={label} info={info}>
      <div className="flex items-center gap-2">
        <UiRangeInput
          value={value}
          min={0}
          max={1}
          step={0.01}
          aria-label={label}
          onFocus={onBegin}
          onPointerDown={onBegin}
          onPointerUp={handlePointerUp}
          onPointerCancel={onCancel}
          onBlur={onCommit}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
        />
        <span className={`w-10 shrink-0 text-right text-text-dark ${UI_TEXT_META_CLASS}`}>
          {Math.round(value * 100)}%
        </span>
      </div>
    </UiFormRow>
  );
}

export function VgpuGlowInspector(): JSX.Element {
  const controller = useImageEditorDocumentController();
  const operation = controller.getOperation<VgpuGlowOperationParams>(IMAGE_EDIT_OPERATION_IDS.vgpuGlow);
  const params = operation?.params ?? createDefaultVgpuGlowOperationParams();
  const update = (patch: (current: VgpuGlowOperationParams) => VgpuGlowOperationParams): void => {
    controller.updateOperation<VgpuGlowOperationParams>(IMAGE_EDIT_OPERATION_IDS.vgpuGlow, patch);
  };
  const setUnit = (key: 'intensity' | 'radius' | 'chromaticAberration' | 'sourceThreshold' | 'whiteHeat') =>
    (value: number): void => update((current) => ({ ...current, [key]: value }));
  const setTintColor = (tintColor: string): void => update((current) => ({ ...current, tintColor }));
  const rangeHandlers = {
    onBegin: controller.beginTransaction,
    onCommit: controller.commitTransaction,
    onCancel: controller.cancelTransaction,
  };
  const setEnabled = (enabled: boolean): void => {
    controller.beginTransaction();
    if (enabled) controller.setOperationEnabled(IMAGE_EDIT_OPERATION_IDS.diffusion, false);
    controller.setOperationEnabled(IMAGE_EDIT_OPERATION_IDS.vgpuGlow, enabled);
    controller.commitTransaction();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className={UI_TEXT_SECTION_CLASS}>辉光 Pro</h2>
          <p className={`mt-1 ${UI_TEXT_META_CLASS}`}>多层光晕 · GPU 实时渲染</p>
        </div>
        <UiSwitch
          checked={operation?.enabled ?? false}
          onCheckedChange={setEnabled}
          aria-label="启用辉光 Pro"
        />
      </div>

      <fieldset disabled={!operation?.enabled} className="m-0 min-w-0 space-y-4 border-0 p-0 disabled:opacity-60">
        <UiGroup gap="row" title="光感" titleTone="overline">
          <div className="grid grid-cols-3 gap-1">
            {LOOK_OPTIONS.map((option) => (
              <UiOptionButton
                key={option.value}
                type="button"
                variant="menu"
                active={params.look === option.value}
                className="justify-center text-xs"
                title={option.detail}
                onClick={() => update(() => applyVgpuGlowLook(option.value))}
              >
                {option.label}
              </UiOptionButton>
            ))}
          </div>
        </UiGroup>

        <UiGroup gap="row" title="光晕" titleTone="overline" divided>
          <UiFormRow
            label="着色"
            info="使用所选颜色生成辉光，原图本身的颜色不会被替换。"
            inline
          >
            <span className={UI_TEXT_META_CLASS}>{params.tintColor.toUpperCase()}</span>
            <UiColorInput
              value={params.tintColor}
              aria-label="辉光颜色"
              onFocus={controller.beginTransaction}
              onPointerDown={controller.beginTransaction}
              onBlur={controller.commitTransaction}
              onChange={(event) => setTintColor(event.currentTarget.value)}
            />
          </UiFormRow>
          <GlowRangeField
            label="发光半径"
            value={params.radius}
            info="控制光线从发光体向外扩散的距离，不改变光源能量。"
            onChange={setUnit('radius')}
            {...rangeHandlers}
          />
          <GlowRangeField
            label="发光强度"
            value={params.intensity}
            info="控制辉光叠加到原图的能量，不改变扩散距离。"
            onChange={setUnit('intensity')}
            {...rangeHandlers}
          />
          <GlowRangeField
            label="色差"
            value={params.chromaticAberration}
            info="沿每个发光轮廓分离红、绿、蓝通道，形成镜头像差般的彩色边缘。"
            onChange={setUnit('chromaticAberration')}
            {...rangeHandlers}
          />
        </UiGroup>

        <UiGroup gap="row" title="光源" titleTone="overline" divided>
          <GlowRangeField
            label="亮源门槛"
            value={params.sourceThreshold}
            info="数值越低，画面中越多区域会被视为发光体。"
            onChange={setUnit('sourceThreshold')}
            {...rangeHandlers}
          />
          <GlowRangeField
            label="核心白热"
            value={params.whiteHeat}
            info="让最亮的光源核心趋近白色，外围仍保留所选辉光颜色。"
            onChange={setUnit('whiteHeat')}
            {...rangeHandlers}
          />
        </UiGroup>
      </fieldset>

      {operation?.enabled && controller.previewState?.phase === 'failed' ? (
        <UiError
          size="xs"
          title="辉光预览失败"
          message="当前图片暂时无法渲染辉光，请调整参数或重新打开图片后重试。"
        />
      ) : null}

      <div className="mt-4 flex gap-2">
        <UiChipButton
          type="button"
          className="!h-8 flex-1 !justify-center !text-xs"
          onClick={() => controller.resetOperation(IMAGE_EDIT_OPERATION_IDS.vgpuGlow)}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          重置
        </UiChipButton>
        <UiChipButton
          type="button"
          className="!h-8 flex-1 !justify-center !text-xs"
          disabled={!operation}
          onClick={() => controller.removeOperation(IMAGE_EDIT_OPERATION_IDS.vgpuGlow)}
        >
          <Trash2 className="h-3.5 w-3.5" />
          移除
        </UiChipButton>
      </div>
    </div>
  );
}
