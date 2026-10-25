/**
 * ModelscopeCustomModelPanel
 *
 * 魔搭自定义模型（特殊面板，重要记录 021）：列表就是选择，添加为一行；选择与增删改都在同一个列表里。
 */

import React, { useCallback, useEffect, useState } from 'react'
import ModelscopeCustomModelManager from '@/components/MediaGenerator/components/ModelscopeCustomModelManager'
import { UiSpecialPanel } from '@/components/ui'
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

  return (
    <UiSpecialPanel>
      <ModelscopeCustomModelManager onModelsChange={refreshModels} selectedId={value} onSelect={onChange} />
    </UiSpecialPanel>
  )
}

export default ModelscopeCustomModelPanel
