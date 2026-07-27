import { createLogger } from '@/core/logging'
import React, { useState, useEffect } from 'react'
import TextInput from '@/components/ui/TextInput'
import { showAlertDialog } from '@/stores/alertDialogStore'
import {
  UI_TEXT_BODY_CLASS,
  UI_TEXT_LABEL_CLASS,
  UI_TEXT_META_CLASS,
  UiButton,
  UiEmpty,
  UiIconButton,
  UiOptionButton,
  UiPanel,
} from '@/components/ui'
import { openExternal as open } from '@/platform/desktopApi'
import { useI18n } from '@/hooks/useI18n'
import {
  modelscopeCustomModelService,
  type ModelscopeCustomModelEntry,
} from '@/services/modelscopeCustomModels/ModelscopeCustomModelService'

const logger = createLogger('components.MediaGenerator.components.ModelscopeCustomModelManager')

interface ModelscopeCustomModelManagerProps {
  onModelsChange?: () => void | Promise<void>
}
const ModelscopeCustomModelManager: React.FC<ModelscopeCustomModelManagerProps> = ({ onModelsChange }) => {
  const { t } = useI18n('ui')
  const [models, setModels] = useState<ModelscopeCustomModelEntry[]>([])
  const [newModelId, setNewModelId] = useState('')
  const [newModelName, setNewModelName] = useState('')
  const [newModelType, setNewModelType] = useState<'imageGeneration' | 'imageEditing'>('imageGeneration')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editModelType, setEditModelType] = useState<'imageGeneration' | 'imageEditing'>('imageGeneration')
  const [isAddingNew, setIsAddingNew] = useState(false)
  // 弹窗渲染统一收在 App 根部的 GlobalAlertDialog，这里只负责发起
  const showAlert = (title: string, message: string, type: 'info' | 'warning' | 'error' = 'warning') => {
    showAlertDialog({ title, message, type })
  }
  useEffect(() => {
    loadModels()
  }, [])
  const loadModels = async (): Promise<void> => {
    try {
      const nextModels = await modelscopeCustomModelService.listModels()
      setModels(nextModels)
    } catch (e) {
      logger.error('Failed to load custom models:', e)
    }
  }
  const notifyModelsChange = async (): Promise<void> => {
    try {
      await onModelsChange?.()
    } catch (e) {
      logger.error('Failed to notify custom model changes:', e)
    }
  }
  const handleAdd = async (): Promise<void> => {
    if (!newModelId.trim() || !newModelName.trim()) {
      showAlert(t('modelscopeCustomModel.alerts.incomplete.title'), t('modelscopeCustomModel.alerts.incomplete.message'), 'warning')
      return
    }
    if (models.some(m => m.id === newModelId.trim())) {
      showAlert(t('modelscopeCustomModel.alerts.duplicate.title'), t('modelscopeCustomModel.alerts.duplicate.message'), 'warning')
      return
    }
    try {
      await modelscopeCustomModelService.addModel({
        id: newModelId.trim(),
        name: newModelName.trim(),
        modelType: {
          imageGeneration: newModelType === 'imageGeneration',
          imageEditing: newModelType === 'imageEditing'
        }
      })
      await loadModels()
      await notifyModelsChange()
      setNewModelId('')
      setNewModelName('')
      setNewModelType('imageGeneration')
      setIsAddingNew(false)
    } catch (e) {
      logger.error('Failed to save custom model:', e)
    }
  }
  const handleOpenModelLibrary = async () => {
    try {
      await open('https://modelscope.cn/models?filter=inference_type&page=1&tabKey=task&tasks=hotTask:text-to-image-synthesis&type=tasks')
    } catch (error) {
      logger.error('Failed to open model library:', error)
    }
  }
  const handleDelete = async (id: string): Promise<void> => {
    if (confirm(t('modelscopeCustomModel.confirmDelete'))) {
      try {
        await modelscopeCustomModelService.deleteModel(id)
        await loadModels()
        await notifyModelsChange()
      } catch (e) {
        logger.error('Failed to delete custom model:', e)
      }
    }
  }
  const handleStartEdit = (model: ModelscopeCustomModelEntry) => {
    setEditingId(model.id)
    setEditName(model.name)
    setEditModelType(model.modelType.imageGeneration ? 'imageGeneration' : 'imageEditing')
  }
  const handleSaveEdit = async (id: string): Promise<void> => {
    if (!editName.trim()) {
      showAlert(t('modelscopeCustomModel.alerts.nameEmpty.title'), t('modelscopeCustomModel.alerts.nameEmpty.message'), 'warning')
      return
    }
    try {
      await modelscopeCustomModelService.updateModel(id, {
        name: editName.trim(),
        modelType: {
          imageGeneration: editModelType === 'imageGeneration',
          imageEditing: editModelType === 'imageEditing'
        }
      })
      await loadModels()
      await notifyModelsChange()
      setEditingId(null)
      setEditName('')
      setEditModelType('imageGeneration')
    } catch (e) {
      logger.error('Failed to update custom model:', e)
    }
  }
  const handleCancelEdit = () => {
    setEditingId(null)
    setEditName('')
    setEditModelType('imageGeneration')
  }
  return (
    <div className="flex flex-col h-full">
      <UiPanel className="mb-3 p-2.5 bg-blue-900/20 border-blue-800/60">
        <div className="text-xs text-blue-300">
          {t('modelscopeCustomModel.tip.prefix')}
          <UiButton
            type="button"
            size="sm"
            variant="ghost"
            onClick={handleOpenModelLibrary}
            className="mx-1 h-auto px-1.5 py-0.5 text-brand-300 hover:bg-blue-900/50"
          >
            {t('modelscopeCustomModel.tip.library')}
          </UiButton>
          {t('modelscopeCustomModel.tip.suffix')}
        </div>
      </UiPanel>
      {!isAddingNew ? (
        <UiButton
          type="button"
          variant="primary"
          onClick={() => setIsAddingNew(true)}
          className="mb-3 gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          {t('modelscopeCustomModel.addNew')}
        </UiButton>
      ) : (
        <UiPanel className="mb-3 p-3 border-border-dark/60 bg-layer/25">
          <div className="flex items-center justify-between mb-2">
            <div className={UI_TEXT_LABEL_CLASS}>{t('modelscopeCustomModel.addNew')}</div>
            <UiIconButton
              type="button"
              onClick={() => {
                setIsAddingNew(false)
                setNewModelId('')
                setNewModelName('')
              }}
              className="h-8 w-8 border-transparent bg-transparent text-text-muted hover:bg-layer/60"
              aria-label={t('common:close')}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </UiIconButton>
          </div>
          <div className="flex flex-col gap-2">
            <TextInput
              label={t('modelscopeCustomModel.form.modelId')}
              value={newModelId}
              onChange={setNewModelId}
              placeholder={t('modelscopeCustomModel.form.placeholders.modelId')}
              className="w-full"
              inputClassName="w-full text-sm"
            />
            <TextInput
              label={t('modelscopeCustomModel.form.displayName')}
              value={newModelName}
              onChange={setNewModelName}
              placeholder={t('modelscopeCustomModel.form.placeholders.displayName')}
              className="w-full"
              inputClassName="w-full text-sm"
            />
            <div className="flex flex-col gap-2">
              <div className={UI_TEXT_LABEL_CLASS}>{t('modelscopeCustomModel.form.modelType')}</div>
              <div className="grid grid-cols-2 gap-2">
                <UiOptionButton
                  type="button"
                  active={newModelType === 'imageGeneration'}
                  className="justify-center"
                  onClick={() => setNewModelType('imageGeneration')}
                >
                  {t('modelscopeCustomModel.types.imageGeneration')}
                </UiOptionButton>
                <UiOptionButton
                  type="button"
                  active={newModelType === 'imageEditing'}
                  className="justify-center"
                  onClick={() => setNewModelType('imageEditing')}
                >
                  {t('modelscopeCustomModel.types.imageEditing')}
                </UiOptionButton>
              </div>
            </div>
            <div className="flex gap-2">
              <UiButton
                type="button"
                variant="primary"
                onClick={() => void handleAdd()}
                className="flex-1"
              >
                {t('modelscopeCustomModel.actions.confirmAdd')}
              </UiButton>
              <UiButton
                type="button"
                variant="muted"
                onClick={() => {
                  setIsAddingNew(false)
                  setNewModelId('')
                  setNewModelName('')
                  setNewModelType('imageGeneration')
                }}
              >
                {t('common:cancel')}
              </UiButton>
            </div>
          </div>
        </UiPanel>
      )}
      <div className="flex-1 overflow-y-auto">
        {models.length === 0 ? (
          <UiEmpty size="sm" title={t('modelscopeCustomModel.empty')} />
        ) : (
          <div className="space-y-2">
            {models.map(model => (
              <UiPanel
                key={model.id}
                className="p-3 border-border-dark/60 bg-layer/25 hover:border-border-dark/70"
              >
                {editingId === model.id ? (
                  <div className="flex flex-col gap-2">
                  <div className={`break-all ${UI_TEXT_META_CLASS}`}>
                      {t('modelscopeCustomModel.form.modelId')}: {model.id}
                    </div>
                    <TextInput
                      label={t('modelscopeCustomModel.form.displayName')}
                      value={editName}
                      onChange={setEditName}
                      className="w-full"
                      inputClassName="w-full text-sm"
                    />
                    <div className="flex flex-col gap-2">
                      <div className={UI_TEXT_LABEL_CLASS}>{t('modelscopeCustomModel.form.modelType')}</div>
                      <div className="grid grid-cols-2 gap-2">
                        <UiOptionButton
                          type="button"
                          active={editModelType === 'imageGeneration'}
                          className="justify-center"
                          onClick={() => setEditModelType('imageGeneration')}
                        >
                          {t('modelscopeCustomModel.types.imageGeneration')}
                        </UiOptionButton>
                        <UiOptionButton
                          type="button"
                          active={editModelType === 'imageEditing'}
                          className="justify-center"
                          onClick={() => setEditModelType('imageEditing')}
                        >
                          {t('modelscopeCustomModel.types.imageEditing')}
                        </UiOptionButton>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <UiButton
                        type="button"
                        size="sm"
                        variant="primary"
                        onClick={() => void handleSaveEdit(model.id)}
                        className="flex-1"
                      >
                        {t('common:save')}
                      </UiButton>
                      <UiButton
                        type="button"
                        size="sm"
                        variant="muted"
                        onClick={handleCancelEdit}
                        className="flex-1"
                      >
                        {t('common:cancel')}
                      </UiButton>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className={`truncate ${UI_TEXT_BODY_CLASS}`}>
                        {model.name}
                      </div>
                      <div className={`mt-1 break-all ${UI_TEXT_META_CLASS}`}>
                        {model.id}
                      </div>
                      <div className="flex gap-2 mt-1.5">
                        {model.modelType.imageGeneration && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-blue-900/30 text-blue-300">
                            {t('modelscopeCustomModel.types.imageGeneration')}
                          </span>
                        )}
                        {model.modelType.imageEditing && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-green-900/30 text-green-300">
                            {t('modelscopeCustomModel.types.imageEditing')}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <UiButton
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleStartEdit(model)}
                        className="h-7 px-2.5 text-xs text-brand-300 hover:bg-accent/10"
                        title={t('common:edit')}
                      >
                        {t('common:edit')}
                      </UiButton>
                      <UiButton
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleDelete(model.id)}
                        className="h-7 px-2.5 text-xs text-red-400 hover:bg-red-500/10"
                        title={t('modelscopeCustomModel.actions.deleteTitle')}
                      >
                        {t('common:delete')}
                      </UiButton>
                    </div>
                  </div>
                )}
              </UiPanel>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
export default ModelscopeCustomModelManager

