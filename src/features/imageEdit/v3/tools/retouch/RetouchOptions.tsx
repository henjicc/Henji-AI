import { useTranslation } from 'react-i18next';
import { UiButton, UiFormRow, UiSwitch } from '@/components/ui';
import NumberInput from '@/components/ui/NumberInput';
import { useImageEditorSessionStoreV3 } from '../../store';
import type { ToolOptionsProps } from '../../toolFramework/types';
import { ImageEditorRepairParametersV3 } from '../../editor/ImageEditorRepairParametersV3';

export function RetouchOptions({ controller, bus }: ToolOptionsProps): JSX.Element | null {
  const { t } = useTranslation('ui'), session = useImageEditorSessionStoreV3(state => state.sessions[controller.sessionId]);
  if (!session) return null;
  if (session.activeTool === 'content-aware-fill') return <ImageEditorRepairParametersV3 controller={controller} bus={bus} />;
  const settings = session.toolSettings, store = useImageEditorSessionStoreV3.getState(), label = (key: string): string => t(`imageEditor.v3.retouch.${key}`);
  return <div data-retouch-options className="flex h-full min-w-max items-center gap-3">
    <UiFormRow inline density="compact" label={label('size')}><NumberInput size="sm" ariaLabel={label('size')} widthClassName="w-16" value={settings.brushSize} min={1} onChange={value => store.setToolSetting(controller.sessionId, 'brushSize', value)} /></UiFormRow>
    <UiFormRow inline density="compact" label={label('opacity')}><NumberInput size="sm" ariaLabel={label('opacity')} widthClassName="w-16" value={Math.round(settings.brushOpacity * 100)} min={0} max={100} onChange={value => store.setToolSetting(controller.sessionId, 'brushOpacity', value / 100)} /></UiFormRow>
    <UiFormRow inline density="compact" label={label('flow')}><NumberInput size="sm" ariaLabel={label('flow')} widthClassName="w-16" value={Math.round((settings.brushDynamics.flow ?? 1) * 100)} min={0} max={100} onChange={value => store.setToolSetting(controller.sessionId, 'brushDynamics', { ...settings.brushDynamics, flow: value / 100 })} /></UiFormRow>
    <UiFormRow inline density="compact" label={label('hardness')}><NumberInput size="sm" ariaLabel={label('hardness')} widthClassName="w-16" value={Math.round(settings.brushHardness * 100)} min={0} max={100} onChange={value => store.setToolSetting(controller.sessionId, 'brushHardness', value / 100)} /></UiFormRow>
    <UiFormRow inline density="compact" label={label('aligned')}><UiSwitch aria-label={label('aligned')} checked={settings.retouchAligned} onCheckedChange={value => { store.setToolSetting(controller.sessionId, 'retouchAligned', value); store.setToolSetting(controller.sessionId, 'retouchOffset', null); }} /></UiFormRow>
    <UiFormRow inline density="compact" label={label('showSource')}><UiSwitch aria-label={label('showSource')} checked={settings.retouchShowSource} onCheckedChange={value => store.setToolSetting(controller.sessionId, 'retouchShowSource', value)} /></UiFormRow>
    <UiButton size="sm" aria-pressed={settings.retouchPicking} onClick={() => store.setToolSetting(controller.sessionId, 'retouchPicking', !settings.retouchPicking)}>{label(settings.retouchSource ? 'resample' : 'sample')}</UiButton>
  </div>;
}
