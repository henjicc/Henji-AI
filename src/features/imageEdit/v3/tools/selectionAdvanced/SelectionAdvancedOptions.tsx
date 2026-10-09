import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dropdown, PanelTrigger, UiButton, UiError, UiFormRow, UiLoading, UiRangeInput, UiSwitch } from '@/components/ui';
import type { ImageEditAdvancedSelectionIntentV3 } from '@/core/imageEdit/v3/selection/advanced';
import { useSelectionAdvancedV3 } from './SelectionAdvancedContext';

export function SelectionAdvancedOptionsV3({ tool, hasSelection }: { tool: string; hasSelection: boolean }): JSX.Element | null {
  const view = useSelectionAdvancedV3(), { t } = useTranslation('ui');
  const [mode, setMode] = useState<Extract<ImageEditAdvancedSelectionIntentV3, { kind: 'modify' }>['mode']>('expand'), [radius, setRadius] = useState(.01);
  if (!view) return null;
  const advanced = ['select-wand', 'select-color-range', 'select-focus'].includes(tool);
  const label = (key: string): string => t(`imageEditor.v3.selectionAdvanced.${key}`);
  return <div className="flex shrink-0 items-center gap-2" data-selection-advanced-options>
    <PanelTrigger panelWidth={280} renderPanel={() => <div className="flex flex-col gap-3" data-selection-advanced-settings>
      {advanced && tool !== 'select-focus' ? <>
        <UiFormRow density="compact" label={label('tolerance')}><UiRangeInput aria-label={label('tolerance')} min={0} max={1} step={.01} value={view.tolerance} onChange={e => view.configure({ tolerance: Number(e.currentTarget.value) })} /></UiFormRow>
        {tool === 'select-wand' && <UiFormRow density="compact" label={label('contiguous')} inline><UiSwitch aria-label={label('contiguous')} checked={view.contiguous} onCheckedChange={contiguous => view.configure({ contiguous })} /></UiFormRow>}
        <UiButton size="sm" disabled={!view.points.length} onClick={() => view.configure({ points: [] })}>{label('clearSamples')}</UiButton>
      </> : advanced ? <>
        <UiFormRow density="compact" label={label('range')}><UiRangeInput aria-label={label('range')} min={0} max={1} step={.01} value={view.range} onChange={e => view.configure({ range: Number(e.currentTarget.value) })} /></UiFormRow>
        <UiFormRow density="compact" label={label('noise')}><UiRangeInput aria-label={label('noise')} min={0} max={1} step={.01} value={view.noise} onChange={e => view.configure({ noise: Number(e.currentTarget.value) })} /></UiFormRow>
      </> : <>
        <UiFormRow density="compact" label={label('mode')}><Dropdown value={mode} display={label(mode)} options={(['expand', 'contract', 'smooth', 'feather', 'border'] as const).map(value => ({ value, label: label(value) }))} onSelect={value => { view.cancel(); setMode(value); }} /></UiFormRow>
        <UiFormRow density="compact" label={label('radius')}><UiRangeInput aria-label={label('radius')} min={.001} max={1} step={.001} value={radius} onChange={e => { view.cancel(); setRadius(Number(e.currentTarget.value)); }} /><span className="text-xs text-text2">{(radius * 100).toFixed(1)}%</span></UiFormRow>
      </>}
      <div className="flex items-center gap-2">
        <UiButton disabled={view.busy || (!advanced && !hasSelection) || (advanced && tool !== 'select-focus' && !view.points.length)} onClick={() => void view.run(advanced ? undefined : { kind: 'modify', mode, radiusRatio: radius })}>{label('preview')}</UiButton>
        <UiButton variant="primary" disabled={!view.preview || view.busy} onClick={view.apply}>{label('apply')}</UiButton>
        <UiButton onClick={view.cancel}>{label('cancel')}</UiButton>
      </div>
      {view.busy && <UiLoading size="sm" message={label('preparing')}><span className="text-xs text-text2">{Math.round(view.progress * 100)}%</span></UiLoading>}
      {view.error && <UiError size="sm" message={view.error} />}
    </div>}>
      {({ togglePanel, open }) => <UiButton size="sm" aria-expanded={open} onClick={togglePanel}>{label(advanced ? 'settings' : 'modify')}</UiButton>}
    </PanelTrigger>
    {view.preview && <><UiButton size="sm" variant="primary" onClick={view.apply}>{label('apply')}</UiButton><UiButton size="sm" onClick={view.cancel}>{label('cancel')}</UiButton></>}
  </div>;
}
