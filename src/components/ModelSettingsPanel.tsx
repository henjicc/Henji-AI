import React, { useState } from 'react'
import { getAvailableProviders } from '../utils/modelHelpers'
import { getHiddenProviders, saveHiddenProviders, getHiddenTypes, saveHiddenTypes, getHiddenModels, saveHiddenModels, type Provider } from '../config/providers'
import { useI18n } from '@/hooks/useI18n'
import { UiButton, UiChipButton, UiOptionButton, UiPanel } from '@/components/ui'

const ModelSettingsPanel: React.FC = () => {
  const { t } = useI18n('settings')
  // 获取所有可用的 providers
  const providers = getAvailableProviders()

  // 使用惰性初始化，直接从 localStorage 读取初始值
  const [hiddenProviders, setHiddenProviders] = useState<Set<string>>(() => getHiddenProviders())
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(() => getHiddenTypes())
  const [hiddenModels, setHiddenModels] = useState<Set<string>>(() => getHiddenModels())

  const toggleModelVisibility = (providerId: string, modelId: string) => {
    const key = `${providerId}-${modelId}`
    const newHiddenModels = new Set(hiddenModels)

    if (newHiddenModels.has(key)) {
      newHiddenModels.delete(key)
    } else {
      newHiddenModels.add(key)
    }

    setHiddenModels(newHiddenModels)
    saveHiddenModels(newHiddenModels)

    // 触发事件通知其他组件更新
    window.dispatchEvent(new Event('modelVisibilityChanged'))
  }

  const isProviderVisible = (providerId: string) => {
    // 检查该供应商是否在隐藏列表中
    return !hiddenProviders.has(providerId)
  }

  const isTypeVisible = (type: 'image' | 'video' | 'audio') => {
    // 检查该类型是否在隐藏列表中
    return !hiddenTypes.has(type)
  }

  const toggleProviderVisibility = (providerId: string) => {
    const newHiddenProviders = new Set(hiddenProviders)

    if (newHiddenProviders.has(providerId)) {
      newHiddenProviders.delete(providerId)
    } else {
      newHiddenProviders.add(providerId)
    }

    setHiddenProviders(newHiddenProviders)
    saveHiddenProviders(newHiddenProviders)
    window.dispatchEvent(new Event('modelVisibilityChanged'))
  }

  const showAllModelsForProvider = (providerId: string) => {
    const provider = providers.find(p => p.id === providerId)
    if (!provider) return

    const newHiddenModels = new Set(hiddenModels)
    provider.models.forEach(model => {
      const key = `${providerId}-${model.id}`
      newHiddenModels.delete(key)
    })

    setHiddenModels(newHiddenModels)
    saveHiddenModels(newHiddenModels)
    window.dispatchEvent(new Event('modelVisibilityChanged'))
  }

  const hideAllModelsForProvider = (providerId: string) => {
    const provider = providers.find(p => p.id === providerId)
    if (!provider) return

    const newHiddenModels = new Set(hiddenModels)
    provider.models.forEach(model => {
      const key = `${providerId}-${model.id}`
      newHiddenModels.add(key)
    })

    setHiddenModels(newHiddenModels)
    saveHiddenModels(newHiddenModels)
    window.dispatchEvent(new Event('modelVisibilityChanged'))
  }

  const toggleTypeVisibility = (type: 'image' | 'video' | 'audio') => {
    const newHiddenTypes = new Set(hiddenTypes)

    if (newHiddenTypes.has(type)) {
      newHiddenTypes.delete(type)
    } else {
      newHiddenTypes.add(type)
    }

    setHiddenTypes(newHiddenTypes)
    saveHiddenTypes(newHiddenTypes)
    window.dispatchEvent(new Event('modelVisibilityChanged'))
  }

  const showAll = () => {
    setHiddenProviders(new Set())
    saveHiddenProviders(new Set())
    setHiddenTypes(new Set())
    saveHiddenTypes(new Set())
    setHiddenModels(new Set())
    saveHiddenModels(new Set())
    window.dispatchEvent(new Event('modelVisibilityChanged'))
  }

  const hideAll = () => {
    const allProviders = new Set(providers.map(p => p.id))
    setHiddenProviders(allProviders)
    saveHiddenProviders(allProviders)
    window.dispatchEvent(new Event('modelVisibilityChanged'))
  }

  const resetToDefault = () => {
    setHiddenProviders(new Set())
    saveHiddenProviders(new Set())
    setHiddenTypes(new Set())
    saveHiddenTypes(new Set())
    setHiddenModels(new Set())
    saveHiddenModels(new Set())
    window.dispatchEvent(new Event('modelVisibilityChanged'))
  }

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'image': return t('modelSettings.types.image')
      case 'video': return t('modelSettings.types.video')
      case 'audio': return t('modelSettings.types.audio')
      default: return type
    }
  }

  const getTypeBadgeColor = (type: string) => {
    switch (type) {
      case 'image': return 'bg-blue-500/20 text-blue-400 border-blue-500/30'
      case 'video': return 'bg-purple-500/20 text-purple-400 border-purple-500/30'
      case 'audio': return 'bg-green-500/20 text-green-400 border-green-500/30'
      default: return 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30'
    }
  }

  const isModelHidden = (providerId: string, modelId: string, modelType: string) => {
    // 供应商被隐藏
    if (hiddenProviders.has(providerId)) return true
    // 类型被隐藏
    if (hiddenTypes.has(modelType)) return true
    // 单个模型被隐藏
    if (hiddenModels.has(`${providerId}-${modelId}`)) return true
    return false
  }

  const getProviderStats = (provider: Provider) => {
    const total = provider.models.length
    const hidden = provider.models.filter(model =>
      isModelHidden(provider.id, model.id, model.type)
    ).length
    const visible = total - hidden
    return { total, visible, hidden }
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {/* 快速操作区域 */}
      <div>
        <h4 className="text-xs font-medium text-zinc-400 mb-3 uppercase tracking-wider">{t('modelSettings.quickActionsTitle')}</h4>
        <UiPanel className="space-y-3 border-zinc-700/40 bg-zinc-800/30 p-4">
          {/* 全局操作 */}
          <div className="flex gap-2 flex-wrap">
            <UiButton
              type="button"
              size="sm"
              variant="primary"
              onClick={showAll}
            >
              {t('modelSettings.actions.showAll')}
            </UiButton>
            <UiButton
              type="button"
              size="sm"
              variant="muted"
              onClick={hideAll}
            >
              {t('modelSettings.actions.hideAll')}
            </UiButton>
            <UiButton
              type="button"
              size="sm"
              variant="muted"
              onClick={resetToDefault}
            >
              {t('modelSettings.actions.resetDefault')}
            </UiButton>
          </div>

          {/* 按供应商操作 */}
          <div className="pt-3 border-t border-zinc-700/30">
            <p className="text-xs text-zinc-500 mb-2">{t('modelSettings.byProvider')}</p>
            <div className="flex gap-2 flex-wrap">
              {providers.map(provider => {
                const isVisible = isProviderVisible(provider.id)
                return (
                  <UiChipButton
                    key={provider.id}
                    type="button"
                    active={isVisible}
                    onClick={() => toggleProviderVisibility(provider.id)}
                    className={`h-8 px-3 text-xs ${!isVisible ? 'opacity-40' : ''}`}
                  >
                    {provider.name}
                  </UiChipButton>
                )
              })}
            </div>
          </div>

          {/* 按类型操作 */}
          <div className="pt-3 border-t border-zinc-700/30">
            <p className="text-xs text-zinc-500 mb-2">{t('modelSettings.byType')}</p>
            <div className="flex gap-2 flex-wrap">
              {(['image', 'video', 'audio'] as const).map(type => {
                const isVisible = isTypeVisible(type)
                return (
                  <UiChipButton
                    key={type}
                    type="button"
                    active={isVisible}
                    onClick={() => toggleTypeVisibility(type)}
                    className={`h-8 px-3 text-xs ${!isVisible ? 'opacity-40' : ''}`}
                  >
                    {getTypeLabel(type)}
                  </UiChipButton>
                )
              })}
            </div>
          </div>
        </UiPanel>
      </div>

      {/* 模型列表 */}
      <div>
        <h4 className="text-xs font-medium text-zinc-400 mb-3 uppercase tracking-wider">{t('modelSettings.listTitle')}</h4>
        <div className="space-y-3">
          {providers.map(provider => {
            const stats = getProviderStats(provider)
            return (
              <UiPanel key={provider.id} className="overflow-hidden border-zinc-700/40 bg-zinc-800/30">
                {/* 供应商标题 */}
                <div className="px-4 py-3 bg-zinc-900/50 border-b border-zinc-700/30 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h5 className="text-sm font-medium text-white">{provider.name}</h5>
                    <span className="text-xs text-zinc-500">
                      {t('modelSettings.visibleCount', { visible: stats.visible, total: stats.total })}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <UiButton
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => showAllModelsForProvider(provider.id)}
                      className="h-7 px-2.5 text-xs text-brand-300"
                    >
                      {t('modelSettings.actions.showAll')}
                    </UiButton>
                    <span className="text-zinc-600">|</span>
                    <UiButton
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => hideAllModelsForProvider(provider.id)}
                      className="h-7 px-2.5 text-xs text-zinc-400"
                    >
                      {t('modelSettings.actions.hideAll')}
                    </UiButton>
                  </div>
                </div>

                {/* 模型列表 */}
                <div className="p-2">
                  {provider.models.map(model => {
                    const isHidden = isModelHidden(provider.id, model.id, model.type)
                    return (
                      <UiOptionButton
                        key={model.id}
                        type="button"
                        active={!isHidden}
                        variant="menu"
                        onClick={() => toggleModelVisibility(provider.id, model.id)}
                        className={`mb-1 w-full justify-between px-3 py-2.5 ${isHidden ? 'opacity-40' : 'opacity-100'}`}
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-sm text-white">{model.name}</span>
                          <span className={`text-xs px-2 py-0.5 rounded border ${getTypeBadgeColor(model.type)}`}>
                            {getTypeLabel(model.type)}
                          </span>
                        </div>
                        <div className="text-xs text-zinc-500">
                          {isHidden ? t('modelSettings.status.hidden') : t('modelSettings.status.visible')}
                        </div>
                      </UiOptionButton>
                    )
                  })}
                </div>
              </UiPanel>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default ModelSettingsPanel

