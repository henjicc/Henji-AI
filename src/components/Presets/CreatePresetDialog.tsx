import { createLogger } from '@/core/logging'

const logger = createLogger('components.Presets.CreatePresetDialog')
/**
 * CreatePresetDialog Component
 *
 * 创建预设对话框
 */

import React, { useState } from 'react'
import { usePresetLoader } from '@/hooks/usePresetLoader'
import type { CreatePresetInput } from '@/core/types/Preset'
import { useI18n } from '@/hooks/useI18n'
import { UiButton, UiCheckbox, UiInput, UiModal, UiTextAreaField } from '@/components/ui'

interface CreatePresetDialogProps {
  currentModelId: string
  onSave: (input: CreatePresetInput) => Promise<void>
  onClose: () => void
}

export function CreatePresetDialog({
  currentModelId,
  onSave,
  onClose
}: CreatePresetDialogProps) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isGlobal, setIsGlobal] = useState(false)
  const [saving, setSaving] = useState(false)
  const { createPresetFromCurrent } = usePresetLoader(currentModelId)

  const handleSave = async () => {
    if (!name.trim()) {
      return
    }

    setSaving(true)
    try {
      const presetData = createPresetFromCurrent(name, description)

      await onSave({
        ...presetData,
        modelId: isGlobal ? null : currentModelId
      })

      onClose()
    } catch (error) {
      logger.error('Failed to save preset:', error)
    } finally {
      setSaving(false)
    }
  }

  return (
    <UiModal
      isOpen
      title={t('ui:presets.create.title')}
      onClose={onClose}
      hideHeader
      size="form"
      contentClassName="p-6"
    >
        <h3 className="text-xl font-bold mb-4">{t('ui:presets.create.title')}</h3>

        <div className="form-group mb-4">
          <label className="block text-sm font-medium mb-2">{t('ui:presets.create.nameLabel')}</label>
          <UiInput
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={t('ui:presets.create.placeholders.name')}
          />
        </div>

        <div className="form-group mb-4">
          <label className="block text-sm font-medium mb-2">{t('ui:presets.create.descriptionLabel')}</label>
          <UiTextAreaField
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder={t('ui:presets.create.placeholders.description')}
            rows={3}
          />
        </div>

        <div className="form-group mb-6">
          <label className="flex items-center gap-2">
            <UiCheckbox
              checked={isGlobal}
              onCheckedChange={setIsGlobal}
            />
            <span className="text-sm font-medium">{t('ui:presets.create.globalLabel')}</span>
          </label>
          <p className="text-xs text-text-faint mt-1 ml-6">
            {isGlobal
              ? t('ui:presets.create.globalHint')
              : t('ui:presets.create.modelHint', { modelId: currentModelId })
            }
          </p>
        </div>

        <div className="dialog-actions flex gap-3">
          <UiButton
            onClick={onClose}
            disabled={saving}
            variant="ghost"
            className="flex-1"
          >
            {t('common:cancel')}
          </UiButton>
          <UiButton
            onClick={handleSave}
            disabled={!name.trim() || saving}
            variant="primary"
            className="flex-1"
          >
            {saving ? t('ui:presets.create.saving') : t('common:save')}
          </UiButton>
        </div>
    </UiModal>
  )
}

