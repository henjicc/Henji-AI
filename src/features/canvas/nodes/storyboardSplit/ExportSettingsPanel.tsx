import { useTranslation } from 'react-i18next';

import type { StoryboardExportOptions } from '@/features/canvas/domain/canvasNodes';
import NumberField from '@/components/ui/NumberInput';
import {
  UiCheckbox,
  UiColorInput,
  UiFormRow,
  UiInput,
  UiSelect,
} from '@/components/ui';

interface StoryboardExportSettingsPanelProps {
  exportOptions: StoryboardExportOptions;
  onPatch: (patch: Partial<StoryboardExportOptions>) => void;
}

const K = 'canvas.storyboardExport.';

/**
 * 导出设置的面板内容。浮层外壳（定位、玻璃表面、点外与 Escape 关闭、浮层归属）由
 * `StoryboardNode` 里的 `PanelTrigger` 提供（任务 5.9）。
 *
 * 行统一走 `UiFormRow density="compact"`（标签左、控件右），控件统一 sm 档（28）：
 * 原来下拉与文本框是 32、数值框是 28、颜色是被拉成 28 高的长条，同一面板里三种高度（任务 5.4）。
 */
export function StoryboardExportSettingsPanel({
  exportOptions,
  onPatch,
}: StoryboardExportSettingsPanelProps): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <UiFormRow label={t(`${K}showIndex`)} density="compact" inline>
        <UiCheckbox
          aria-label={t(`${K}showIndex`)}
          checked={exportOptions.showFrameIndex}
          onCheckedChange={(checked) => onPatch({ showFrameIndex: checked })}
        />
      </UiFormRow>

      <UiFormRow label={t(`${K}showNote`)} density="compact" inline>
        <UiCheckbox
          aria-label={t(`${K}showNote`)}
          checked={exportOptions.showFrameNote}
          onCheckedChange={(checked) => onPatch({ showFrameNote: checked })}
        />
      </UiFormRow>

      <UiFormRow label={t(`${K}imageFit`)} density="compact" inline>
        <UiSelect
          size="sm"
          aria-label={t(`${K}imageFit`)}
          value={exportOptions.imageFit}
          onChange={(event) =>
            onPatch({
              imageFit: event.target.value === 'contain' ? 'contain' : 'cover',
            })
          }
        >
          <option value="cover">{t(`${K}fitCover`)}</option>
          <option value="contain">{t(`${K}fitContain`)}</option>
        </UiSelect>
      </UiFormRow>

      <UiFormRow label={t(`${K}notePlacement`)} density="compact" inline>
        <UiSelect
          size="sm"
          aria-label={t(`${K}notePlacement`)}
          value={exportOptions.notePlacement}
          onChange={(event) =>
            onPatch({
              notePlacement: event.target.value === 'bottom' ? 'bottom' : 'overlay',
            })
          }
        >
          <option value="overlay">{t(`${K}noteOverlay`)}</option>
          <option value="bottom">{t(`${K}noteBottom`)}</option>
        </UiSelect>
      </UiFormRow>

      <UiFormRow label={t(`${K}indexPrefix`)} density="compact" inline>
        <UiInput
          size="sm"
          className="!w-24"
          aria-label={t(`${K}indexPrefix`)}
          value={exportOptions.frameIndexPrefix}
          maxLength={4}
          onChange={(event) => onPatch({ frameIndexPrefix: event.target.value })}
          textHistory={{ onValueChange: (value) => onPatch({ frameIndexPrefix: value }) }}
        />
      </UiFormRow>

      <UiFormRow label={t(`${K}gap`)} density="compact" inline>
        <NumberField
          min={0}
          max={120}
          value={exportOptions.cellGap}
          onChange={(value) => onPatch({ cellGap: value || 0 })}
          textHistory={{ onValueChange: (value) => onPatch({ cellGap: Number(value) || 0 }) }}
          size="sm"
          align="center"
          widthClassName="w-24"
          commitOnChange
          ariaLabel={t(`${K}gap`)}
        />
      </UiFormRow>

      <UiFormRow label={t(`${K}fontSize`)} density="compact" inline>
        <NumberField
          min={1}
          max={20}
          value={exportOptions.fontSize}
          onChange={(value) => onPatch({ fontSize: value || 4 })}
          textHistory={{ onValueChange: (value) => onPatch({ fontSize: Number(value) || 4 }) }}
          size="sm"
          align="center"
          widthClassName="w-24"
          commitOnChange
          ariaLabel={t(`${K}fontSize`)}
        />
      </UiFormRow>

      <UiFormRow label={t(`${K}background`)} density="compact" inline>
        <UiColorInput
          aria-label={t(`${K}background`)}
          value={exportOptions.backgroundColor}
          onChange={(event) => onPatch({ backgroundColor: event.target.value })}
        />
      </UiFormRow>

      <UiFormRow label={t(`${K}textColor`)} density="compact" inline>
        <UiColorInput
          aria-label={t(`${K}textColor`)}
          value={exportOptions.textColor}
          onChange={(event) => onPatch({ textColor: event.target.value })}
        />
      </UiFormRow>
    </div>
  );
}
