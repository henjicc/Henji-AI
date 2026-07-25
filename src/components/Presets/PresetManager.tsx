import { createLogger } from '@/core/logging'

const logger = createLogger('components.Presets.PresetManager')
/**
 * PresetManager Component
 *
 * 预设管理 UI 组件
 */

import React, { useState } from 'react'
import { usePresets } from '@/hooks/usePresets'
import { usePresetLoader } from '@/hooks/usePresetLoader'
import type { Preset } from '@/core/types/Preset'
import { CreatePresetDialog } from './CreatePresetDialog'
import { useI18n } from '@/hooks/useI18n'
import { UiButton, UiPanel } from '@/components/ui'

interface PresetItemProps {
  preset: Preset
  currentModelId: string
  onApply: () => void
  onToggleFavorite: () => void
  onDelete: () => void
}

function PresetItem({ preset, currentModelId, onApply, onToggleFavorite, onDelete }: PresetItemProps) {
  const { t } = useI18n()
  const isGlobal = preset.modelId === null
  const isCompatible = isGlobal || preset.modelId === currentModelId

  return (
    <UiPanel className="preset-item mb-3 border p-4 hover:bg-zinc-700/35">
      <div className="flex justify-between items-start">
        <div className="preset-info flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-lg">{preset.name}</h3>
            {preset.isFavorite && <span className="text-yellow-500">★</span>}
            {isGlobal && (
              <span className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 px-2 py-1 rounded">
                {t('ui:presets.labels.global')}
              </span>
            )}
            {!isCompatible && (
              <span className="text-xs bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200 px-2 py-1 rounded">
                {t('ui:presets.labels.incompatible')}
              </span>
            )}
          </div>
          {preset.description && (
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">{preset.description}</p>
          )}
          <div className="text-xs text-gray-500">
            <span>{preset.modelId || t('ui:presets.labels.allModels')}</span>
            <span className="mx-2">·</span>
            <span>{t('ui:presets.labels.usageCount', { count: preset.useCount })}</span>
          </div>
        </div>

        <div className="preset-actions flex gap-2 ml-4">
          <UiButton
            onClick={onToggleFavorite}
            size="sm"
            variant="muted"
            className="h-8 px-3"
            title={preset.isFavorite ? t('ui:presets.actions.unfavorite') : t('ui:presets.actions.favorite')}
          >
            {preset.isFavorite ? '★' : '☆'}
          </UiButton>
          <UiButton
            onClick={onApply}
            size="sm"
            variant="primary"
            className="h-8 px-3"
          >
            {t('common:actions.apply')}
          </UiButton>
          <UiButton
            onClick={onDelete}
            size="sm"
            variant="ghost"
            className="h-8 px-3 border-red-500/70 text-red-400 hover:bg-red-500/10"
          >
            {t('common:delete')}
          </UiButton>
        </div>
      </div>
    </UiPanel>
  )
}

interface PresetManagerProps {
  currentModelId: string
  onClose: () => void
}

export function PresetManager({ currentModelId, onClose }: PresetManagerProps) {
  const { t } = useI18n()
  const { presets, loading, createPreset, deletePreset, toggleFavorite, applyPreset } = usePresets()
  const { applyPreset: applyToModel } = usePresetLoader(currentModelId)
  const [showCreateDialog, setShowCreateDialog] = useState(false)

  const handleApply = async (presetId: string) => {
    const preset = presets.find(p => p.id === presetId)
    if (preset) {
      const result = applyToModel(preset)
      await applyPreset(presetId)  // 增加使用次数

      // 显示应用结果
      logger.info(`[PresetManager] Applied ${result.applied} params, ignored ${result.ignored} params`)

      if (result.ignored > 0) {
        logger.warn('[PresetManager] Ignored parameters:', result.ignoredParams)
      }

      onClose()
    }
  }

  return (
    <div className="preset-manager fixed inset-0 bg-black/50 flex items-center justify-center z-modal">
      <UiPanel className="p-6 max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col">
        <div className="preset-header flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">{t('ui:presets.manager.title')}</h2>
          <div className="flex gap-2">
            <UiButton
              onClick={() => setShowCreateDialog(true)}
              variant="primary"
              size="sm"
              className="h-9 px-4"
            >
              {t('ui:presets.manager.create')}
            </UiButton>
            <UiButton
              onClick={onClose}
              variant="ghost"
              size="sm"
              className="h-9 px-4"
            >
              {t('common:close')}
            </UiButton>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="text-gray-500">{t('common:loading')}</div>
          </div>
        ) : presets.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <div className="text-gray-500">{t('ui:presets.manager.empty')}</div>
          </div>
        ) : (
          <div className="preset-list overflow-y-auto flex-1">
            {presets.map(preset => (
              <PresetItem
                key={preset.id}
                preset={preset}
                currentModelId={currentModelId}
                onApply={() => handleApply(preset.id)}
                onToggleFavorite={() => toggleFavorite(preset.id)}
                onDelete={() => deletePreset(preset.id)}
              />
            ))}
          </div>
        )}

        {showCreateDialog && (
          <CreatePresetDialog
            currentModelId={currentModelId}
            onSave={async (input) => { await createPreset(input) }}
            onClose={() => setShowCreateDialog(false)}
          />
        )}
      </UiPanel>
    </div>
  )
}

