import { useEffect, useRef, useState } from 'react'
import type { Provider } from '@/config/providers'
import {
  getHiddenModels,
  getHiddenProviders,
  getHiddenTypes,
  saveHiddenModels,
  saveHiddenProviders,
  saveHiddenTypes,
} from '@/config/providers'
import { migrateLegacyTypeVisibility } from './providerCenterModel'

export interface GenerationModelVisibilityState {
  hiddenProviders: Set<string>
  hiddenModels: Set<string>
  setProviderEnabled(providerId: string, enabled: boolean): void
  setModelEnabled(providerId: string, modelId: string, enabled: boolean): void
  setModelsEnabled(models: readonly { providerId: string; modelId: string }[], enabled: boolean): void
}

function notifyVisibilityChanged(): void {
  window.dispatchEvent(new Event('modelVisibilityChanged'))
}

export function useGenerationModelVisibility(providers: readonly Provider[]): GenerationModelVisibilityState {
  const legacyHiddenTypesRef = useRef<Set<string>>(getHiddenTypes())
  const [hiddenProviders, setHiddenProviders] = useState<Set<string>>(() => getHiddenProviders())
  const [hiddenModels, setHiddenModels] = useState<Set<string>>(() => (
    migrateLegacyTypeVisibility(providers, legacyHiddenTypesRef.current, getHiddenModels())
  ))

  useEffect(() => {
    if (legacyHiddenTypesRef.current.size === 0) return
    // 旧的“按类型隐藏”会让单模型开关看似打开却仍不可见。首次进入统一中心时把它无损展开
    // 成逐模型状态，之后所有入口只维护供应商和模型两级真相。
    saveHiddenModels(hiddenModels)
    saveHiddenTypes(new Set())
    legacyHiddenTypesRef.current = new Set()
    notifyVisibilityChanged()
  }, [hiddenModels])

  const setProviderEnabled = (providerId: string, enabled: boolean): void => {
    setHiddenProviders(current => {
      const next = new Set(current)
      if (enabled) next.delete(providerId)
      else next.add(providerId)
      saveHiddenProviders(next)
      notifyVisibilityChanged()
      return next
    })
  }

  const setModelsEnabled = (
    models: readonly { providerId: string; modelId: string }[],
    enabled: boolean,
  ): void => {
    setHiddenModels(current => {
      const next = new Set(current)
      for (const model of models) {
        const key = `${model.providerId}-${model.modelId}`
        if (enabled) next.delete(key)
        else next.add(key)
      }
      saveHiddenModels(next)
      notifyVisibilityChanged()
      return next
    })
  }

  return {
    hiddenProviders,
    hiddenModels,
    setProviderEnabled,
    setModelEnabled: (providerId, modelId, enabled) => setModelsEnabled([{ providerId, modelId }], enabled),
    setModelsEnabled,
  }
}
