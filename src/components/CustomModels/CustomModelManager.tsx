/**
 * 自定义模型管理器
 */

import React, { useState, useEffect } from 'react'
import { CustomModel } from '@/core/types/CustomModel'
import { getCustomModelService } from '@/services/customModels/CustomModelService'
import { databaseService } from '@/services/database/DatabaseService'
import { AddCustomModelDialog } from './AddCustomModelDialog'
import { useI18n } from '@/hooks/useI18n'

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
      console.error('Failed to load custom models:', error)
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
      console.error('Failed to add custom model:', error)
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
      console.error('Failed to toggle model:', error)
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
      console.error('Failed to delete model:', error)
    }
  }

  if (loading) {
    return <div className="p-4">{t('customModels.loading')}</div>
  }

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold">{t('customModels.title')}</h2>
        <button
          onClick={() => setShowAddDialog(true)}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          {t('customModels.add')}
        </button>
      </div>

      {models.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <p>{t('customModels.empty')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {models.map(model => (
            <div
              key={model.id}
              className="p-4 border rounded flex justify-between items-center"
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
                <button
                  onClick={() => handleToggleEnabled(model.id, model.isEnabled)}
                  className={`px-3 py-1 rounded text-sm ${
                    model.isEnabled
                      ? 'bg-green-500 text-white'
                      : 'bg-gray-300 text-gray-700'
                  }`}
                >
                  {model.isEnabled ? t('customModels.enabled') : t('customModels.disabled')}
                </button>

                <button
                  onClick={() => handleDelete(model.id)}
                  className="px-3 py-1 bg-red-500 text-white rounded text-sm hover:bg-red-600"
                >
                  {t('delete')}
                </button>
              </div>
            </div>
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
