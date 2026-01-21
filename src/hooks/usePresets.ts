/**
 * usePresets Hook
 *
 * 预设管理 Hook，提供预设的 CRUD 操作
 */

import { useState, useEffect, useCallback } from 'react'
import type { Preset, CreatePresetInput, PresetQueryOptions, UpdatePresetInput } from '@/core/types/Preset'
import { presetService } from '@/services/presets/PresetService'

/**
 * 预设管理 Hook
 *
 * @param options - 查询选项
 * @returns 预设管理接口
 *
 * @example
 * ```tsx
 * function PresetList() {
 *   const { presets, loading, createPreset, deletePreset } = usePresets()
 *
 *   return (
 *     <div>
 *       {presets.map(preset => (
 *         <div key={preset.id}>{preset.name}</div>
 *       ))}
 *     </div>
 *   )
 * }
 * ```
 */
export function usePresets(options?: PresetQueryOptions) {
  const [presets, setPresets] = useState<Preset[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  // 加载预设列表
  const loadPresets = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await presetService.getPresets(options)
      setPresets(data)
    } catch (err) {
      setError(err as Error)
    } finally {
      setLoading(false)
    }
  }, [options])

  useEffect(() => {
    loadPresets()
  }, [loadPresets])

  // 创建预设
  const createPreset = useCallback(async (input: CreatePresetInput) => {
    const preset = await presetService.createPreset(input)
    setPresets(prev => [preset, ...prev])
    return preset
  }, [])

  // 更新预设
  const updatePreset = useCallback(async (id: string, updates: UpdatePresetInput) => {
    await presetService.updatePreset(id, updates)
    setPresets(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p))
  }, [])

  // 删除预设
  const deletePreset = useCallback(async (id: string) => {
    await presetService.deletePreset(id)
    setPresets(prev => prev.filter(p => p.id !== id))
  }, [])

  // 切换收藏
  const toggleFavorite = useCallback(async (id: string) => {
    await presetService.toggleFavorite(id)
    setPresets(prev => prev.map(p =>
      p.id === id ? { ...p, isFavorite: !p.isFavorite } : p
    ))
  }, [])

  // 应用预设
  const applyPreset = useCallback(async (id: string) => {
    const preset = await presetService.applyPreset(id)
    if (preset) {
      setPresets(prev => prev.map(p => p.id === id ? preset : p))
    }
    return preset
  }, [])

  return {
    presets,
    loading,
    error,
    createPreset,
    updatePreset,
    deletePreset,
    toggleFavorite,
    applyPreset,
    reload: loadPresets
  }
}

/**
 * 指定模型的预设 Hook
 *
 * @param modelId - 模型 ID（null 表示全局预设）
 * @returns 预设管理接口
 *
 * @example
 * ```tsx
 * function ModelPresets({ modelId }: { modelId: string }) {
 *   const { presets, loading } = useModelPresets(modelId)
 *
 *   return (
 *     <div>
 *       <h3>预设列表（包括全局预设）</h3>
 *       {presets.map(preset => (
 *         <div key={preset.id}>{preset.name}</div>
 *       ))}
 *     </div>
 *   )
 * }
 * ```
 */
export function useModelPresets(modelId: string | null) {
  return usePresets({ modelId })
}
