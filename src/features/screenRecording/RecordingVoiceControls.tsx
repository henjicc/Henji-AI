import { useTranslation } from 'react-i18next'
import { Dropdown, UiFormRow } from '@/components/ui'
import ParameterPanel from '@/components/MediaGenerator/components/ParameterPanel'
import { registry } from '@/core/ModelRegistry'
import { getI18nText } from '@/core/types'

export function RecordingVoiceControls({ modelId, options, onModelChange, onOptionsChange }: { modelId: string; options: DynamicValueMap; onModelChange: (id: string) => void; onOptionsChange: (options: DynamicValueMap) => void }): React.ReactElement {
  const { t, i18n } = useTranslation('ui')
  const models = registry.listAllModels().filter(model => model.meta.type === 'audio' && model.params.some(param => 'panel' in param && param.panel === 'voice-selector'))
  return <>
    <UiFormRow label={t('recording.directorVoice')}><Dropdown value={modelId} options={models.map(model => ({ value: model.meta.id, label: getI18nText(model.meta.name, i18n.language) || model.meta.id }))} onSelect={id => { onModelChange(id); onOptionsChange(registry.getDefaultValues(id)) }} /></UiFormRow>
    <UiFormRow label=""><ParameterPanel currentModel={modelId} selectedModel={modelId} uploadedImages={[]} uploadedVideos={[]} values={options} onChange={(key, value) => onOptionsChange({ ...options, [key]: value })} onChanges={changes => onOptionsChange({ ...options, ...changes })} /></UiFormRow>
  </>
}
