/**
 * ModelscopeCustomModelPanel
 *
 * Provides custom model selection and embeds the manager UI.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Dropdown from '@/components/ui/Dropdown'
import ModelscopeCustomModelManager from '@/components/MediaGenerator/components/ModelscopeCustomModelManager'
import { useI18n } from '@/hooks/useI18n'
import { UI_TEXT_LABEL_CLASS, UI_TEXT_META_CLASS } from '@/components/ui'
import {
  modelscopeCustomModelService,
  type ModelscopeCustomModelEntry,
} from '@/services/modelscopeCustomModels/ModelscopeCustomModelService'

export interface ModelscopeCustomModelPanelProps {
  value: string
  onChange: (value: string) => void
  config?: DynamicValueMap
}

export const ModelscopeCustomModelPanel: React.FC<ModelscopeCustomModelPanelProps> = ({
  value,
  onChange
}) => {
  const { t } = useI18n('ui')
  const [models, setModels] = useState<ModelscopeCustomModelEntry[]>([])

  const refreshModels = useCallback(async (): Promise<void> => {
    const nextModels = await modelscopeCustomModelService.listModels()
    setModels(nextModels)
  }, [])

  useEffect(() => {
    void refreshModels()
  }, [refreshModels])

  useEffect(() => {
    if (!value) return
    if (!models.some(model => model.id === value)) {
      onChange('')
    }
  }, [models, value, onChange])

  const selectedModel = useMemo(
    () => models.find(model => model.id === value),
    [models, value]
  )

  const options = useMemo(() => {
    if (models.length === 0) {
      return [{ value: '', label: t('modelscopeCustomModelPanel.empty'), disabled: true }]
    }
    return models.map(model => {
      const typeLabel = model.modelType.imageEditing
        ? t('modelscopeCustomModelPanel.type.imageEditing')
        : (model.modelType.imageGeneration ? t('modelscopeCustomModelPanel.type.imageGeneration') : t('modelscopeCustomModelPanel.type.DynamicValue'))
      return {
        value: model.id,
        label: `${model.name} (${typeLabel})`
      }
    })
  }, [models, t])

  const display = useMemo(() => {
    if (!value) {
      return models.length === 0
        ? t('modelscopeCustomModelPanel.empty')
        : t('modelscopeCustomModelPanel.select')
    }
    if (selectedModel) {
      return selectedModel.name
    }
    return value
  }, [models.length, selectedModel, t, value])

  return (
    <div className="flex flex-col h-full max-h-full overflow-hidden">
      <div className="px-4 pt-3 pb-2">
        <div className={`mb-2 ${UI_TEXT_LABEL_CLASS}`}>{t('modelscopeCustomModelPanel.label')}</div>
        <Dropdown
          value={value || ''}
          display={display}
          options={options}
          onSelect={(next) => onChange(String(next))}
          buttonClassName="w-full"
        />
        {selectedModel && (
          <div className={`mt-2 ${UI_TEXT_META_CLASS}`}>
            <span className="text-text-muted">{t('modelscopeCustomModelPanel.modelIdLabel')}</span>
            <span className="break-all">{selectedModel.id}</span>
          </div>
        )}
      </div>

      <div className="px-4">
        <div className="border-t border-border-dark/50" />
      </div>

      <div className="flex-1 min-h-0 px-4 pb-4 pt-3 overflow-hidden">
        <ModelscopeCustomModelManager onModelsChange={refreshModels} />
      </div>
    </div>
  )
}

export default ModelscopeCustomModelPanel
