import { createLogger } from '@/core/logging'

const logger = createLogger('components.CustomModels.CustomModelManager')
/**
 * 自定义模型管理器
 */

import React, { useState, useEffect } from 'react'
import { CustomModel } from '@/core/types/CustomModel'
import { getCustomModelService } from '@/services/customModels/CustomModelService'
import { databaseService } from '@/services/database/DatabaseService'
import { AddCustomModelDialog } from './AddCustomModelDialog'
import { useI18n } from '@/hooks/useI18n'
import { UiButton, UiChipButton, UiPanel } from '@/components/ui'

export function CustomModelManager() {
  const [models, setModels] = useState<CustomModel[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const { t } = useI18n('ui')

  const service = getCustomModelService(databaseService)

  // 加载模型列表
  useEffect(() => {
    loadModels()
  }, [])

  const loadModels = async () => {
    try {
      setLoading(true)
      const data = await service.getCustomModels()
      setModels(data)
    } catch (error) {
      logger.error('Failed to load custom models:', error)
    } finally {
      setLoading(false)
    }
  }

  // 添加模型
  const handleAdd = async (name: string, modelUrl: string, description?: string) => {
    try {
      await service.addCustomModel({
        name,
        modelUrl,
        description,
        provider: 'modelscope',
        type: 'image'
      })
      await loadModels()
      setShowAddDialog(false)
    } catch (error) {
      logger.error('Failed to add custom model:', error)
      alert(t('customModels.addFailed') + ': ' + (error as Error).message)
    }
  }

  // 切换启用状态
  const handleToggleEnabled = async (id: string, currentState: boolean) => {
    try {
      if (currentState) {
        await service.disableCustomModel(id)
      } else {
        await service.enableCustomModel(id)
      }
      await loadModels()
    } catch (error) {
      logger.error('Failed to toggle model:', error)
    }
  }

  // 删除模型
  const handleDelete = async (id: string) => {
    if (!confirm(t('customModels.confirmDelete'))) {
      return
    }

    try {
      await service.deleteCustomModel(id)
      await loadModels()
    } catch (error) {
      logger.error('Failed to delete model:', error)
    }
  }

  if (loading) {
    return <div className="p-4">{t('customModels.loading')}</div>
  }

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold">{t('customModels.title')}</h2>
        <UiButton
          variant="primary"
          size="sm"
          onClick={() => setShowAddDialog(true)}
        >
          {t('customModels.add')}
        </UiButton>
      </div>

      {models.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <p>{t('customModels.empty')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {models.map(model => (
            <UiPanel
              key={model.id}
              className="flex items-center justify-between p-4"
            >
              <div className="flex-1">
                <div className="font-medium">{model.name}</div>
                {model.description && (
                  <div className="text-sm text-gray-500">{model.description}</div>
                )}
                <div className="text-xs text-gray-400 mt-1">
                  {model.modelUrl}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <UiChipButton
                  active={model.isEnabled}
                  onClick={() => handleToggleEnabled(model.id, model.isEnabled)}
                  className={`px-3 py-1 rounded text-sm ${
                    model.isEnabled
                      ? 'bg-green-500 text-white'
                      : 'bg-gray-300 text-gray-700'
                  }`}
                >
                  {model.isEnabled ? t('customModels.enabled') : t('customModels.disabled')}
                </UiChipButton>

                <UiButton
                  variant="primary"
                  size="sm"
                  onClick={() => handleDelete(model.id)}
                  className="bg-red-500 text-white hover:bg-red-600"
                >
                  {t('delete')}
                </UiButton>
              </div>
            </UiPanel>
          ))}
        </div>
      )}

      {showAddDialog && (
        <AddCustomModelDialog
          onAdd={handleAdd}
          onClose={() => setShowAddDialog(false)}
        />
      )}
    </div>
  )
}

