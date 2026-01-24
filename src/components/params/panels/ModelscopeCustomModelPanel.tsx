/**
 * ModelscopeCustomModelPanel
 *
 * Provides custom model selection and embeds the manager UI.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Dropdown from '@/components/ui/Dropdown'
import ModelscopeCustomModelManager from '@/components/MediaGenerator/components/ModelscopeCustomModelManager'

interface CustomModelType {
  imageGeneration: boolean
  imageEditing: boolean
}

interface CustomModel {
  id: string
  name: string
  modelType: CustomModelType
}

export interface ModelscopeCustomModelPanelProps {
  value: string
  onChange: (value: string) => void
  config?: Record<string, unknown>
}

const STORAGE_KEY = 'modelscope_custom_models'

function normalizeModelType(raw: unknown): CustomModelType {
  if (!raw || typeof raw !== 'object') {
    return { imageGeneration: true, imageEditing: false }
  }

  const record = raw as Record<string, unknown>
  const imageGeneration = record.imageGeneration === true
  const imageEditing = record.imageEditing === true && !imageGeneration

  return { imageGeneration, imageEditing }
}

function parseCustomModels(raw: string | null): CustomModel[] {
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []

    const models: CustomModel[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const record = item as Record<string, unknown>
      const id = typeof record.id === 'string' ? record.id.trim() : ''
      if (!id) continue
      const name = typeof record.name === 'string' && record.name.trim()
        ? record.name.trim()
        : id
      const modelType = normalizeModelType(record.modelType)
      models.push({ id, name, modelType })
    }

    return models
  } catch {
    return []
  }
}

export const ModelscopeCustomModelPanel: React.FC<ModelscopeCustomModelPanelProps> = ({
  value,
  onChange
}) => {
  const [models, setModels] = useState<CustomModel[]>([])

  const refreshModels = useCallback(() => {
    setModels(parseCustomModels(localStorage.getItem(STORAGE_KEY)))
  }, [])

  useEffect(() => {
    refreshModels()
  }, [refreshModels])

  useEffect(() => {
    const handler = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) {
        refreshModels()
      }
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
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
      return [{ value: '', label: 'Add models first', disabled: true }]
    }
    return models.map(model => {
      const typeLabel = model.modelType.imageEditing
        ? 'Image Edit'
        : (model.modelType.imageGeneration ? 'Image Gen' : 'Unlabeled')
      return {
        value: model.id,
        label: `${model.name} (${typeLabel})`
      }
    })
  }, [models])

  const display = useMemo(() => {
    if (!value) {
      return models.length === 0 ? 'Add models first' : 'Select a model'
    }
    if (selectedModel) {
      return selectedModel.name
    }
    return value
  }, [models.length, selectedModel, value])

  return (
    <div className="flex flex-col h-full max-h-full overflow-hidden">
      <div className="px-4 pt-3 pb-2">
        <div className="text-xs text-zinc-400 mb-2">Select custom model</div>
        <Dropdown
          value={value || ''}
          display={display}
          options={options}
          onSelect={(next) => onChange(String(next))}
          buttonClassName="w-full"
        />
        {selectedModel && (
          <div className="mt-2 text-xs text-zinc-500">
            <span className="text-zinc-400">Model ID:</span>
            <span className="break-all">{selectedModel.id}</span>
          </div>
        )}
      </div>

      <div className="px-4">
        <div className="border-t border-zinc-700/50" />
      </div>

      <div className="flex-1 min-h-0 px-4 pb-4 pt-3 overflow-hidden">
        <ModelscopeCustomModelManager onModelsChange={refreshModels} />
      </div>
    </div>
  )
}

export default ModelscopeCustomModelPanel
