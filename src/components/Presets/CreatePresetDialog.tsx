/**
 * CreatePresetDialog Component
 *
 * 创建预设对话框
 */

import React, { useState } from 'react'
import { usePresetLoader } from '@/hooks/usePresetLoader'
import type { CreatePresetInput } from '@/core/types/Preset'
import { useI18n } from '@/hooks/useI18n'

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
      console.error('Failed to save preset:', error)
    } finally {
      setSaving(false)
    }
  }

  return (
      <div className="preset-dialog fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full">
        <h3 className="text-xl font-bold mb-4">{t('ui:presets.create.title')}</h3>

        <div className="form-group mb-4">
          <label className="block text-sm font-medium mb-2">{t('ui:presets.create.nameLabel')}</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={t('ui:presets.create.placeholders.name')}
            className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600"
          />
        </div>

        <div className="form-group mb-4">
          <label className="block text-sm font-medium mb-2">{t('ui:presets.create.descriptionLabel')}</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder={t('ui:presets.create.placeholders.description')}
            rows={3}
            className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600"
          />
        </div>

        <div className="form-group mb-6">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={isGlobal}
              onChange={e => setIsGlobal(e.target.checked)}
              className="w-4 h-4"
            />
            <span className="text-sm font-medium">{t('ui:presets.create.globalLabel')}</span>
          </label>
          <p className="text-xs text-gray-500 mt-1 ml-6">
            {isGlobal
              ? t('ui:presets.create.globalHint')
              : t('ui:presets.create.modelHint', { modelId: currentModelId })
            }
          </p>
        </div>

        <div className="dialog-actions flex gap-3">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 px-4 py-2 border rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            {t('common:cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || saving}
            className="flex-1 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
          >
            {saving ? t('ui:presets.create.saving') : t('common:save')}
          </button>
        </div>
      </div>
    </div>
  )
}
