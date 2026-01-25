/**
 * 添加自定义模型对话框
 */

import React, { useState } from 'react'
import { useI18n } from '@/hooks/useI18n'

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
      alert(t('customModels.validation.missingNameOrUrl'))
      return
    }

    onAdd(name.trim(), modelUrl.trim(), description.trim() || undefined)
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <h3 className="text-lg font-bold mb-4">{t('customModels.addModel')}</h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              {t('customModels.name')} *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border rounded"
              placeholder={t('customModels.placeholders.name')}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              {t('customModels.url')} *
            </label>
            <input
              type="text"
              value={modelUrl}
              onChange={(e) => setModelUrl(e.target.value)}
              className="w-full px-3 py-2 border rounded"
              placeholder={t('customModels.placeholders.url')}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              {t('customModels.descriptionOptional')}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 border rounded"
              rows={3}
              placeholder={t('customModels.placeholders.description')}
            />
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border rounded hover:bg-gray-100"
            >
              {t('common:cancel')}
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              {t('customModels.add')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
