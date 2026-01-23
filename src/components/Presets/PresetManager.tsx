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

interface PresetItemProps {
  preset: Preset
  currentModelId: string
  onApply: () => void
  onToggleFavorite: () => void
  onDelete: () => void
}

function PresetItem({ preset, currentModelId, onApply, onToggleFavorite, onDelete }: PresetItemProps) {
  const isGlobal = preset.modelId === null
  const isCompatible = isGlobal || preset.modelId === currentModelId

  return (
    <div className="preset-item border rounded-lg p-4 mb-3 hover:bg-gray-50 dark:hover:bg-gray-700">
      <div className="flex justify-between items-start">
        <div className="preset-info flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-lg">{preset.name}</h3>
            {preset.isFavorite && <span className="text-yellow-500">★</span>}
            {isGlobal && (
              <span className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 px-2 py-1 rounded">
                全局
              </span>
            )}
            {!isCompatible && (
              <span className="text-xs bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200 px-2 py-1 rounded">
                不兼容
              </span>
            )}
          </div>
          {preset.description && (
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">{preset.description}</p>
          )}
          <div className="text-xs text-gray-500">
            <span>{preset.modelId || '适用于所有模型'}</span>
            <span className="mx-2">·</span>
            <span>使用 {preset.useCount} 次</span>
          </div>
        </div>

        <div className="preset-actions flex gap-2 ml-4">
          <button
            onClick={onToggleFavorite}
            className="px-3 py-1 border rounded hover:bg-gray-100 dark:hover:bg-gray-600"
            title={preset.isFavorite ? '取消收藏' : '收藏'}
          >
            {preset.isFavorite ? '★' : '☆'}
          </button>
          <button
            onClick={onApply}
            className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            应用
          </button>
          <button
            onClick={onDelete}
            className="px-3 py-1 border border-red-500 text-red-500 rounded hover:bg-red-50 dark:hover:bg-red-900/20"
          >
            删除
          </button>
        </div>
      </div>
    </div>
  )
}

interface PresetManagerProps {
  currentModelId: string
  onClose: () => void
}

export function PresetManager({ currentModelId, onClose }: PresetManagerProps) {
  const { presets, loading, createPreset, deletePreset, toggleFavorite, applyPreset } = usePresets()
  const { applyPreset: applyToModel } = usePresetLoader(currentModelId)
  const [showCreateDialog, setShowCreateDialog] = useState(false)

  const handleApply = async (presetId: string) => {
    const preset = presets.find(p => p.id === presetId)
    if (preset) {
      const result = applyToModel(preset)
      await applyPreset(presetId)  // 增加使用次数

      // 显示应用结果
      console.log(`[PresetManager] Applied ${result.applied} params, ignored ${result.ignored} params`)

      if (result.ignored > 0) {
        console.warn('[PresetManager] Ignored parameters:', result.ignoredParams)
      }

      onClose()
    }
  }

  return (
    <div className="preset-manager fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col">
        <div className="preset-header flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">预设管理</h2>
          <div className="flex gap-2">
            <button
              onClick={() => setShowCreateDialog(true)}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              新建预设
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 border rounded hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              关闭
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="text-gray-500">加载中...</div>
          </div>
        ) : presets.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <div className="text-gray-500">暂无预设，点击"新建预设"创建第一个预设</div>
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
      </div>
    </div>
  )
}
