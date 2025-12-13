import React, { useState } from 'react'
import { providers, getHiddenProviders, saveHiddenProviders, getHiddenTypes, saveHiddenTypes, getHiddenModels, saveHiddenModels, type Provider } from '../config/providers'

const ModelSettingsPanel: React.FC = () => {
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
      case 'image': return '图片'
      case 'video': return '视频'
      case 'audio': return '音频'
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
        <h4 className="text-xs font-medium text-zinc-400 mb-3 uppercase tracking-wider">快速操作</h4>
        <div className="bg-zinc-800/30 rounded-xl p-4 border border-zinc-700/30 space-y-3">
          {/* 全局操作 */}
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={showAll}
              className="px-3 py-1.5 bg-[#007eff] hover:bg-[#006add] text-white rounded-lg text-xs transition-all duration-200"
            >
              全部显示
            </button>
            <button
              onClick={hideAll}
              className="px-3 py-1.5 bg-zinc-700/50 hover:bg-zinc-600/50 text-white rounded-lg text-xs transition-all duration-200"
            >
              全部隐藏
            </button>
            <button
              onClick={resetToDefault}
              className="px-3 py-1.5 bg-zinc-700/50 hover:bg-zinc-600/50 text-white rounded-lg text-xs transition-all duration-200"
            >
              重置默认
            </button>
          </div>

          {/* 按供应商操作 */}
          <div className="pt-3 border-t border-zinc-700/30">
            <p className="text-xs text-zinc-500 mb-2">按供应商：</p>
            <div className="flex gap-2 flex-wrap">
              {providers.map(provider => {
                const isVisible = isProviderVisible(provider.id)
                return (
                  <button
                    key={provider.id}
                    onClick={() => toggleProviderVisibility(provider.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs transition-all duration-200 ${
                      isVisible
                        ? 'bg-[#007eff] hover:bg-[#006add] text-white'
                        : 'opacity-40 bg-zinc-700/30 hover:bg-zinc-600/30 text-zinc-400'
                    }`}
                  >
                    {provider.name}
                  </button>
                )
              })}
            </div>
          </div>

          {/* 按类型操作 */}
          <div className="pt-3 border-t border-zinc-700/30">
            <p className="text-xs text-zinc-500 mb-2">按类型：</p>
            <div className="flex gap-2 flex-wrap">
              {(['image', 'video', 'audio'] as const).map(type => {
                const isVisible = isTypeVisible(type)
                return (
                  <button
                    key={type}
                    onClick={() => toggleTypeVisibility(type)}
                    className={`px-3 py-1.5 rounded-lg text-xs transition-all duration-200 ${
                      isVisible
                        ? 'bg-[#007eff] hover:bg-[#006add] text-white'
                        : 'opacity-40 bg-zinc-700/30 hover:bg-zinc-600/30 text-zinc-400'
                    }`}
                  >
                    {getTypeLabel(type)}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* 模型列表 */}
      <div>
        <h4 className="text-xs font-medium text-zinc-400 mb-3 uppercase tracking-wider">模型列表</h4>
        <div className="space-y-3">
          {providers.map(provider => {
            const stats = getProviderStats(provider)
            return (
              <div key={provider.id} className="bg-zinc-800/30 rounded-xl border border-zinc-700/30 overflow-hidden">
                {/* 供应商标题 */}
                <div className="px-4 py-3 bg-zinc-900/50 border-b border-zinc-700/30 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h5 className="text-sm font-medium text-white">{provider.name}</h5>
                    <span className="text-xs text-zinc-500">
                      ({stats.visible}/{stats.total} 可见)
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => showAllModelsForProvider(provider.id)}
                      className="text-xs text-[#007eff] hover:text-[#006add] transition-colors"
                    >
                      全部显示
                    </button>
                    <span className="text-zinc-600">|</span>
                    <button
                      onClick={() => hideAllModelsForProvider(provider.id)}
                      className="text-xs text-zinc-400 hover:text-zinc-300 transition-colors"
                    >
                      全部隐藏
                    </button>
                  </div>
                </div>

                {/* 模型列表 */}
                <div className="p-2">
                  {provider.models.map(model => {
                    const isHidden = isModelHidden(provider.id, model.id, model.type)
                    return (
                      <button
                        key={model.id}
                        onClick={() => toggleModelVisibility(provider.id, model.id)}
                        className={`w-full px-3 py-2.5 rounded-lg flex items-center justify-between hover:bg-zinc-700/30 transition-all duration-200 ${
                          isHidden ? 'opacity-40' : 'opacity-100'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-sm text-white">{model.name}</span>
                          <span className={`text-xs px-2 py-0.5 rounded border ${getTypeBadgeColor(model.type)}`}>
                            {getTypeLabel(model.type)}
                          </span>
                        </div>
                        <div className="text-xs text-zinc-500">
                          {isHidden ? '已隐藏' : '显示中'}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default ModelSettingsPanel
