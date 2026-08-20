/**
 * 添加自定义模型对话框
 */

import React, { useState } from 'react'
import { useI18n } from '@/hooks/useI18n'
import { UiButton, UiInput, UiModal, UiTextAreaField } from '@/components/ui'
import { showAlertDialog } from '@/stores/alertDialogStore'

interface AddCustomModelDialogProps {
  onAdd: (name: string, modelUrl: string, description?: string) => void
  onClose: () => void
}

export function AddCustomModelDialog({ onAdd, onClose }: AddCustomModelDialogProps) {
  const { t } = useI18n('ui')
  const [name, setName] = useState('')
  const [modelUrl, setModelUrl] = useState('')
  const [description, setDescription] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!name.trim() || !modelUrl.trim()) {
      showAlertDialog({
        title: t('common:error'),
        message: t('customModels.validation.missingNameOrUrl'),
        type: 'warning',
      })
      return
    }

    onAdd(name.trim(), modelUrl.trim(), description.trim() || undefined)
  }

  return (
    <UiModal
      isOpen
      title={t('customModels.addModel')}
      onClose={onClose}
      hideHeader
      size="form"
      contentClassName="p-6"
    >
        <h3 className="text-lg font-bold mb-4">{t('customModels.addModel')}</h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              {t('customModels.name')} *
            </label>
            <UiInput
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-10"
              placeholder={t('customModels.placeholders.name')}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              {t('customModels.url')} *
            </label>
            <UiInput
              type="text"
              value={modelUrl}
              onChange={(e) => setModelUrl(e.target.value)}
              className="h-10"
              placeholder={t('customModels.placeholders.url')}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              {t('customModels.descriptionOptional')}
            </label>
            <UiTextAreaField
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-[88px]"
              rows={3}
              placeholder={t('customModels.placeholders.description')}
            />
          </div>

          <div className="flex justify-end gap-2">
            <UiButton
              type="button"
              variant="muted"
              size="sm"
              onClick={onClose}
            >
              {t('common:cancel')}
            </UiButton>
            <UiButton
              type="submit"
              variant="primary"
              size="sm"
            >
              {t('customModels.add')}
            </UiButton>
          </div>
        </form>
    </UiModal>
  )
}
