import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dropdown, ParamField, UiFormRow, type ParamGesture } from '@/components/ui';
import { IMAGE_EDIT_BLEND_MODES_V3, type ImageEditLayerFilterV3 } from '@/core/imageEdit/v3/layerTypes';

export function FilterBlendControlsV3({ filter, disabled, onChange, preview }: {
  filter: ImageEditLayerFilterV3; disabled: boolean;
  preview: { write(value: number): void; finish(value: number): void; cancel(): void };
  onChange: (patch: Partial<Omit<ImageEditLayerFilterV3, 'id'>>) => void;
}): JSX.Element {
  const { t } = useTranslation('ui');
  const [draft, setDraft] = useState(filter.opacity * 100);
  const active = useRef(false), latest = useRef(draft);
  const previewPort = useRef(preview); previewPort.current = preview;
  useEffect(() => () => previewPort.current.cancel(), []);
  useEffect(() => { if (!active.current) { setDraft(filter.opacity * 100); latest.current = filter.opacity * 100; } }, [filter.opacity]);
  useEffect(() => { if (disabled) { previewPort.current.cancel(); active.current = false; setDraft(filter.opacity * 100); latest.current = filter.opacity * 100; } }, [disabled, filter.opacity]);
  const gesture: ParamGesture = {
    begin: () => { if (!disabled) active.current = true; }, active: () => active.current,
    write: value => { if (!disabled && typeof value === 'number') { latest.current = value; setDraft(value); preview.write(value / 100); } },
    finish: () => { if (active.current && !disabled) { active.current = false; preview.finish(latest.current / 100); } },
    cancel: () => { preview.cancel(); active.current = false; latest.current = filter.opacity * 100; setDraft(latest.current); },
    atomic: value => { if (!disabled && typeof value === 'number') onChange({ opacity: value / 100 }); },
  };
  const strength = t('imageEditor.v3.filterWorkspace.strength', { defaultValue: '应用强度' });
  return <>
    <UiFormRow density="compact" label={strength}>
      <ParamField field={{ key: 'opacity', title: strength, type: 'number', control: 'input', default: 100,
        min: 0, max: 100, step: 1, unit: '%', source: 'builtin', bindingKeys: ['opacity'], animatable: false }}
        value={draft} gesture={gesture} disabled={disabled} />
    </UiFormRow>
    <UiFormRow density="compact" label={t('imageEditor.v3.properties.blendMode')}>
      <Dropdown<ImageEditLayerFilterV3['blendMode']> minWidthStrategy="none" value={filter.blendMode} disabled={disabled}
        ariaLabel={t('imageEditor.v3.filterWorkspace.blendMode', { defaultValue: '滤镜混合模式' })}
        display={t(`imageEditor.v3.blendMode.${filter.blendMode}`)}
        options={IMAGE_EDIT_BLEND_MODES_V3.map(value => ({ value, label: t(`imageEditor.v3.blendMode.${value}`) }))}
        onSelect={blendMode => onChange({ blendMode })} />
    </UiFormRow>
  </>;
}
