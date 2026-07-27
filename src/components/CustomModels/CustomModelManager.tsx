import { createLogger } from '@/core/logging'

const logger = createLogger('components.CustomModels.CustomModelManager')
/**
 * 自定义模型管理器
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { CustomModel } from '@/core/types/CustomModel'
import { getCustomModelService } from '@/services/customModels/CustomModelService'
import { databaseService } from '@/services/database/DatabaseService'
import { AddCustomModelDialog } from './AddCustomModelDialog'
import { useI18n } from '@/hooks/useI18n'
import { UiButton, UiEmpty, UiLoading, UiPanel } from '@/components/ui'
import Toggle from '@/components/ui/Toggle'
import { showAlertDialog } from '@/stores/alertDialogStore'

export function CustomModelManager(): JSX.Element {
  const [models, setModels] = useState<CustomModel[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const { t } = useI18n('ui')

  const service = useMemo(() => getCustomModelService(databaseService), [])

  // 加载模型列表
  const loadModels = useCallback(async () => {
    try {
      setLoading(true)
      const data = await service.getCustomModels()
      setModels(data)
    } catch (error) {
      logger.error('Failed to load custom models:', error)
    } finally {
      setLoading(false)
    }
  }, [service])

  useEffect(() => {
    loadModels()
  }, [loadModels])

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
      showAlertDialog({
        title: t('common:error'),
        message: t('customModels.addFailed'),
        type: 'error',
        detail: error instanceof Error ? error.message : String(error),
      })
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
    return <UiLoading message={t('customModels.loading')} />
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
        <UiEmpty size="sm" title={t('customModels.empty')} />
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
                  <div className="text-sm text-text-faint">{model.description}</div>
                )}
                <div className="text-xs text-text-muted mt-1">
                  {model.modelUrl}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Toggle
                  checked={model.isEnabled}
                  onChange={() => {
                    void handleToggleEnabled(model.id, model.isEnabled)
                  }}
                  onText={t('customModels.enabled')}
                  offText={t('customModels.disabled')}
                  ariaLabel={`${model.name} · ${model.isEnabled ? t('customModels.enabled') : t('customModels.disabled')}`}
                />

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

