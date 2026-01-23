import { useState, useEffect } from 'react'
import { getAvailableProviders } from '@/utils/modelHelpers'

/**
 * 模型可见性管理
 * 职责：处理模型隐藏/显示事件
 * 文件大小: < 100 行
 */
export const useModelVisibility = (
  selectedProvider: string,
  selectedModel: string,
  setSelectedProvider: (p: string) => void,
  setSelectedModel: (m: string) => void,
  resetParams: () => void
) => {
  const [modelVisibilityVersion, setModelVisibilityVersion] = useState(0)

  useEffect(() => {
    const handleVisibilityChange = async () => {
      // 更新版本号，强制重新渲染模型选择面板
      setModelVisibilityVersion(v => v + 1)

      // 立即检查当前选中的模型是否还可见
      const { getHiddenProviders, getHiddenTypes, getHiddenModels, getVisibleProviders } =
        await import('@/config/providers')

      const hiddenProviders = getHiddenProviders()
      const hiddenTypes = getHiddenTypes()
      const hiddenModels = getHiddenModels()

      // 检查当前选中的模型是否被隐藏
      const currentModelKey = `${selectedProvider}-${selectedModel}`
      const isProviderHidden = hiddenProviders.has(selectedProvider)

      // 获取当前模型的类型
      const providers = getAvailableProviders()
      const currentProvider = providers.find(p => p.id === selectedProvider)
      const currentModel = currentProvider?.models.find(m => m.id === selectedModel)
      const isTypeHidden = currentModel && hiddenTypes.has(currentModel.type)
      const isModelHidden = hiddenModels.has(currentModelKey)

      // 如果当前模型被隐藏，切换到第一个可见的模型
      if (isProviderHidden || isTypeHidden || isModelHidden) {
        const visibleProviders = getVisibleProviders(hiddenProviders, hiddenTypes, hiddenModels)

        if (visibleProviders.length > 0 && visibleProviders[0].models.length > 0) {
          const firstProvider = visibleProviders[0]
          const firstModel = firstProvider.models[0]

          setSelectedProvider(firstProvider.id)
          setSelectedModel(firstModel.id)
          resetParams()
        }
      }
    }

    window.addEventListener('modelVisibilityChanged', handleVisibilityChange)
    return () => window.removeEventListener('modelVisibilityChanged', handleVisibilityChange)
  }, [selectedProvider, selectedModel, setSelectedProvider, setSelectedModel, resetParams])

  return { modelVisibilityVersion }
}
