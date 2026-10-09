import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Dropdown, PanelTrigger, UiButton, UiColorInput, UiFormRow, UiGroup, UiRangeInput, UiSwitch } from '@/components/ui';
import NumberInput from '@/components/ui/NumberInput';
import { PaintDabGenerator, rasterizePaintDabs, type PaintBrush } from '@/core/imaging/paint';
import { useImageEditorSessionStoreV3 } from '../../store';
import type { ToolOptionsProps } from '../../toolFramework/types';
import { imageEditPaintBrushV3 } from './settings';

function PaintTipPreview({ brush }: { brush: PaintBrush }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const shape = { ...brush, size: Math.min(40, brush.size) };
    const generator = new PaintDabGenerator(shape), dabs = generator.append([{ x: 24, y: 32, pressure: .2 }, { x: 192, y: 32, pressure: 1 }]);
    dabs.push(...generator.finish());
    const output = new Float32Array(216 * 64);
    rasterizePaintDabs({ width: 216, height: 64, originX: 0, originY: 0, before: new Float32Array(output.length), output, coverage: new Float32Array(output.length) },
      dabs, shape, { kind: 'mask', value: 1 }, 'brush');
    const context = canvas.getContext('2d');
    if (!context) return;
    const pixels = context.createImageData(216, 64);
    for (let i = 0; i < output.length; i++) { pixels.data[i * 4 + 3] = Math.round(output[i] * 255); }
    context.putImageData(pixels, 0, 0);
  }, [brush]);
  return <canvas ref={canvasRef} width={216} height={64} data-paint-tip-preview className="image-editor-transparency-grid w-full" />;
}

export function PaintOptionsV3({ controller }: ToolOptionsProps): JSX.Element | null {
  const { t } = useTranslation('ui');
  const session = useImageEditorSessionStoreV3(state => state.sessions[controller.sessionId]);
  const store = useImageEditorSessionStoreV3.getState();
  if (!session) return null;
  const settings = session.toolSettings, brush = imageEditPaintBrushV3(settings), dynamics = settings.brushDynamics;
  const label = (key: string): string => t(`imageEditor.v3.paint.${key}`);
  const setDynamics = (patch: Partial<typeof dynamics>): void => store.setToolSetting(controller.sessionId, 'brushDynamics', { ...dynamics, ...patch });
  const painting = !['paint-gradient', 'paint-fill'].includes(session.activeTool);
  const mask = session.editTarget === 'mask' || session.activeTool === 'mask-edit';
  return <div data-paint-options className="flex h-full min-w-max items-center gap-3">
    <Dropdown size="sm" value={mask ? 'mask' : 'pixels'} display={label(mask ? 'mask' : 'pixels')}
      options={(['pixels', 'mask'] as const).map(value => ({ value, label: label(value) }))}
      onSelect={value => { store.setEditTarget(controller.sessionId, value as 'pixels' | 'mask'); if (value === 'pixels' && session.activeTool === 'mask-edit') store.setActiveTool(controller.sessionId, 'raster-brush'); }} />
    {session.activeTool === 'mask-edit' && <Dropdown size="sm" value={settings.maskMode} display={label(settings.maskMode)}
      options={(['paint', 'erase'] as const).map(value => ({ value, label: label(value) }))}
      onSelect={value => store.setToolSetting(controller.sessionId, 'maskMode', value as 'paint' | 'erase')} />}
    {painting && <UiFormRow inline density="compact" label={label('size')}><NumberInput size="sm" ariaLabel={label('size')} value={brush.size} min={1} step={1} widthClassName="w-16"
      onChange={value => store.setToolSetting(controller.sessionId, 'brushSize', value)} /></UiFormRow>}
    <UiFormRow inline density="compact" label={label('opacity')}><NumberInput size="sm" ariaLabel={label('opacity')} value={Math.round(brush.opacity * 100)} min={0} max={100} step={1} widthClassName="w-16"
      onChange={value => store.setToolSetting(controller.sessionId, 'brushOpacity', value / 100)} /></UiFormRow>
    {painting && <UiFormRow inline density="compact" label={label('flow')}><NumberInput size="sm" ariaLabel={label('flow')} value={Math.round((brush.flow ?? 1) * 100)} min={0} max={100} step={1} widthClassName="w-16"
      onChange={value => setDynamics({ flow: value / 100 })} /></UiFormRow>}
    {mask ? <UiFormRow inline density="compact" label={label('maskValue')}><NumberInput size="sm" ariaLabel={label('maskValue')} value={Math.round(settings.paintMaskValue * 100)} min={0} max={100} step={1} widthClassName="w-16"
      onChange={value => store.setToolSetting(controller.sessionId, 'paintMaskValue', value / 100)} /></UiFormRow>
      : session.activeTool !== 'eraser' && <UiColorInput aria-label={label('color')} title={label('color')} value={settings.paintColor}
        onChange={event => store.setToolSetting(controller.sessionId, 'paintColor', event.currentTarget.value)} />}
    {session.activeTool === 'paint-gradient' && <>
      <Dropdown size="sm" value={settings.paintGradientKind} display={label(settings.paintGradientKind)}
        options={(['linear', 'radial'] as const).map(value => ({ value, label: label(value) }))}
        onSelect={value => store.setToolSetting(controller.sessionId, 'paintGradientKind', value as 'linear' | 'radial')} />
      {mask ? <UiFormRow inline density="compact" label={label('maskEnd')}><NumberInput size="sm" ariaLabel={label('maskEnd')} value={Math.round(settings.paintMaskEnd * 100)} min={0} max={100} step={1} widthClassName="w-16"
        onChange={value => store.setToolSetting(controller.sessionId, 'paintMaskEnd', value / 100)} /></UiFormRow>
        : <UiColorInput aria-label={label('endColor')} title={label('endColor')} value={settings.paintEndColor}
          onChange={event => store.setToolSetting(controller.sessionId, 'paintEndColor', event.currentTarget.value)} />}
    </>}
    {painting && <PanelTrigger panelPadding="content" panelWidth={280} renderPanel={() => <div className="flex flex-col gap-3" data-paint-brush-settings>
      <PaintTipPreview brush={brush} />
      <UiGroup title={label('tip')} titleTone="compact">
        <UiFormRow label={label('tip')} density="compact"><Dropdown value={dynamics.tip ?? 'round'} display={label(dynamics.tip ?? 'round')} options={(['round', 'chisel'] as const).map(value => ({ value, label: label(value) }))}
          onSelect={value => setDynamics({ tip: value as 'round' | 'chisel' })} /></UiFormRow>
        {([['hardness', settings.brushHardness], ['spacing', dynamics.spacing ?? .15], ['smoothing', dynamics.smoothing ?? 0], ['texture', dynamics.texture ?? 0], ['scatter', dynamics.scatter ?? 0]] as const).map(([key, value]) =>
          <UiFormRow key={key} density="compact" label={label(key)}><UiRangeInput aria-label={label(key)} min={key === 'spacing' ? .01 : 0} max={1} step={.01} value={value}
            onChange={event => key === 'hardness' ? store.setToolSetting(controller.sessionId, 'brushHardness', Number(event.currentTarget.value)) : setDynamics({ [key]: Number(event.currentTarget.value) })} /></UiFormRow>)}
        <NumberInput size="sm" label={label('angle')} ariaLabel={label('angle')} value={dynamics.angle ?? 0} step={1} widthClassName="w-full" onChange={angle => setDynamics({ angle })} />
      </UiGroup>
      <UiGroup title={label('pressure')} titleTone="compact">
        <UiFormRow density="compact" label={label('curve')}><Dropdown value={dynamics.pressureCurve ?? 'linear'} display={label(dynamics.pressureCurve ?? 'linear')}
          options={(['linear', 'soft', 'firm'] as const).map(value => ({ value, label: label(value) }))} onSelect={value => setDynamics({ pressureCurve: value as 'linear' | 'soft' | 'firm' })} /></UiFormRow>
        {(['pressureSize', 'pressureFlow', 'tilt'] as const).map(key => <UiFormRow key={key} density="compact" label={label(key)} inline><UiSwitch aria-label={label(key)} checked={Boolean(dynamics[key])} onCheckedChange={value => setDynamics({ [key]: value })} /></UiFormRow>)}
      </UiGroup>
    </div>}>
      {({ open, togglePanel }) => <UiButton size="sm" aria-expanded={open} onClick={togglePanel}>{label('settings')}</UiButton>}
    </PanelTrigger>}
  </div>;
}
