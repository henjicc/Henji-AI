import { createLogger } from '@/core/logging'
import React, { useState, useEffect } from 'react'
import { requestAlertConfirmation, showAlertDialog } from '@/stores/alertDialogStore'
import { UI_ICON_SIZE_CLASS, UiButton, UiEmpty, UiIconButton, UiInput, UiOptionButton, UiSegmented } from '@/components/ui'
import { openExternal as open } from '@/platform/desktopApi'
import { useI18n } from '@/hooks/useI18n'
import { checkModelscopeModelAvailability } from '@/services/modelscopeCustomModels/availability'
import {
  modelscopeCustomModelService,
  type ModelscopeCustomModelEntry,
} from '@/services/modelscopeCustomModels/ModelscopeCustomModelService'
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react'

const logger = createLogger('components.MediaGenerator.components.ModelscopeCustomModelManager')

interface ModelscopeCustomModelManagerProps {
  onModelsChange?: () => void | Promise<void>
  /** 当前选用的自定义模型；传 onSelect 时列表就是选择 */
  selectedId?: string
  onSelect?: (modelId: string) => void
}
const ModelscopeCustomModelManager: React.FC<ModelscopeCustomModelManagerProps> = ({ onModelsChange, selectedId, onSelect }) => {
  const { t } = useI18n('ui')
  const [models, setModels] = useState<ModelscopeCustomModelEntry[]>([])
  const [newModelId, setNewModelId] = useState('')
  const [newModelName, setNewModelName] = useState('')
  const [newModelType, setNewModelType] = useState<'imageGeneration' | 'imageEditing'>('imageGeneration')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editModelType, setEditModelType] = useState<'imageGeneration' | 'imageEditing'>('imageGeneration')
  const [isAddingNew, setIsAddingNew] = useState(false)
  const [isCheckingAvailability, setIsCheckingAvailability] = useState(false)
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
    const modelId = newModelId.trim()

    // 魔搭 API-Inference 只覆盖平台挑选的一个子集：模型在魔搭有页面不代表能用 API 调。
    // 不做这步校验的话，用户填任何 ID 都能保存，但生成时必然失败且看不出原因。
    setIsCheckingAvailability(true)
    let availability: Awaited<ReturnType<typeof checkModelscopeModelAvailability>>
    try {
      availability = await checkModelscopeModelAvailability(modelId)
    } finally {
      setIsCheckingAvailability(false)
    }

    if (availability.state === 'not-found') {
      showAlert(
        t('modelscopeCustomModel.alerts.notFound.title'),
        t('modelscopeCustomModel.alerts.notFound.message', { modelId }),
        'error'
      )
      return
    }

    if (availability.state === 'unavailable') {
      showAlert(
        t('modelscopeCustomModel.alerts.unavailable.title'),
        t('modelscopeCustomModel.alerts.unavailable.message', { modelId }),
        'error'
      )
      return
    }

    try {
      await modelscopeCustomModelService.addModel({
        id: modelId,
        name: newModelName.trim(),
        ...(availability.state === 'available'
          ? {
              costTier: availability.costTier,
              magicGrainCost: availability.magicGrainCost,
            }
          : {}),
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

      if (availability.state === 'unknown') {
        showAlert(
          t('modelscopeCustomModel.alerts.checkFailed.title'),
          t('modelscopeCustomModel.alerts.checkFailed.message', {
            modelId,
            reason: availability.reason
          }),
          'warning'
        )
      }
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
    // 走应用统一的确认弹窗（随主题），不用浏览器原生 confirm()
    const confirmed = await requestAlertConfirmation({
      title: t('modelscopeCustomModel.actions.deleteTitle'),
      message: t('modelscopeCustomModel.confirmDelete'),
      type: 'warning',
      confirmLabel: t('common:delete'),
      confirmTone: 'danger',
    })
    if (confirmed) {
      try {
        await modelscopeCustomModelService.deleteModel(id)
        await loadModels()
        await notifyModelsChange()
      } catch (e) {
        logger.error('Failed to delete custom model:', e)
        // 删除失败原来只记日志，列表看起来没变化、用户不知道发生了什么（任务 5.8）
        showAlert(t('modelscopeCustomModel.alerts.deleteFailed.title'), t('modelscopeCustomModel.alerts.deleteFailed.message'), 'error')
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
  const typeOptions = (['imageGeneration', 'imageEditing'] as const).map(value => ({ value, label: t(`modelscopeCustomModel.types.${value}`) }))
  const typeLabel = (model: ModelscopeCustomModelEntry): string => model.modelType.imageEditing
    ? t('modelscopeCustomModel.types.imageEditing')
    : t('modelscopeCustomModel.types.imageGeneration')
  const cancelAdd = (): void => {
    setIsAddingNew(false)
    setNewModelId('')
    setNewModelName('')
  }

  // 特殊面板（重要记录 021）：列表就是选择，改名与删除在行尾；添加收成一行，点开才展开成 ID、名称、类型、确认
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-text3">
        {t('modelscopeCustomModel.tip.prefix')}
        <UiButton type="button" variant="link" onClick={handleOpenModelLibrary} className="mx-1">
          {t('modelscopeCustomModel.tip.library')}
        </UiButton>
        {t('modelscopeCustomModel.tip.suffix')}
      </p>
      {models.length === 0 ? (
        isAddingNew ? null : <UiEmpty size="xs" title={t('modelscopeCustomModel.empty')} />
      ) : (
        <div className="flex flex-col gap-0.5">
          {models.map(model => editingId === model.id ? (
            <div key={model.id} className="flex items-center gap-2 py-0.5">
              <span className="w-40 min-w-0 truncate text-2xs text-text3">{model.id}</span>
              <UiInput size="sm" value={editName} onChange={event => setEditName(event.target.value)} aria-label={t('modelscopeCustomModel.form.displayName')} className="w-36" />
              <UiSegmented size="sm" ariaLabel={t('modelscopeCustomModel.form.modelType')} value={editModelType} onChange={setEditModelType} options={typeOptions} />
              <UiButton type="button" size="sm" variant="secondary" onClick={() => void handleSaveEdit(model.id)}>{t('common:save')}</UiButton>
              <UiButton type="button" size="sm" onClick={handleCancelEdit}>{t('common:cancel')}</UiButton>
            </div>
          ) : (
            <div key={model.id} className="flex items-center gap-1">
              <UiOptionButton
                type="button"
                variant="menu"
                active={selectedId === model.id}
                aria-pressed={onSelect ? selectedId === model.id : undefined}
                onClick={() => onSelect?.(model.id)}
                className="min-w-0 flex-1 gap-3"
              >
                <span className="shrink-0">{model.name}</span>
                <span className="min-w-0 flex-1 truncate text-2xs text-text3">{model.id}</span>
                <span className="shrink-0 text-2xs text-text3">{typeLabel(model)}</span>
                {selectedId === model.id ? <Check className={`${UI_ICON_SIZE_CLASS.sm} shrink-0 text-accent-text`} aria-hidden /> : null}
              </UiOptionButton>
              <UiIconButton type="button" size="xs" label={t('common:edit')} tooltip={t('common:edit')} onClick={() => handleStartEdit(model)}>
                <Pencil />
              </UiIconButton>
              <UiIconButton type="button" size="xs" tone="danger" label={t('common:delete')} tooltip={t('modelscopeCustomModel.actions.deleteTitle')} onClick={() => void handleDelete(model.id)}>
                <Trash2 />
              </UiIconButton>
            </div>
          ))}
        </div>
      )}
      {isAddingNew ? (
        <div className="flex items-center gap-2">
          <UiInput size="sm" value={newModelId} onChange={event => setNewModelId(event.target.value)} placeholder={t('modelscopeCustomModel.form.placeholders.modelId')} aria-label={t('modelscopeCustomModel.form.modelId')} className="w-56" />
          <UiInput size="sm" value={newModelName} onChange={event => setNewModelName(event.target.value)} placeholder={t('modelscopeCustomModel.form.placeholders.displayName')} aria-label={t('modelscopeCustomModel.form.displayName')} className="w-36" />
          <UiSegmented size="sm" ariaLabel={t('modelscopeCustomModel.form.modelType')} value={newModelType} onChange={setNewModelType} options={typeOptions} />
          <UiButton type="button" size="sm" variant="secondary" onClick={() => void handleAdd()} disabled={isCheckingAvailability}>
            {isCheckingAvailability ? t('modelscopeCustomModel.actions.checking') : t('modelscopeCustomModel.actions.confirmAdd')}
          </UiButton>
          <UiIconButton type="button" size="sm" label={t('common:close')} onClick={cancelAdd}>
            <X />
          </UiIconButton>
        </div>
      ) : (
        <UiButton type="button" size="sm" onClick={() => setIsAddingNew(true)} className="self-start">
          <Plus />
          {t('modelscopeCustomModel.addNew')}
        </UiButton>
      )}
    </div>
  )
}
export default ModelscopeCustomModelManager
