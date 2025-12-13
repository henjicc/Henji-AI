import React, { useState, useEffect, useMemo } from 'react'
import { providers, getHiddenProviders, getHiddenTypes, getHiddenModels, getVisibleProviders } from '@/config/providers'

interface ModelSelectorPanelProps {
  selectedProvider: string
  selectedModel: string
  modelFilterProvider: string
  modelFilterType: 'all' | 'favorite' | 'image' | 'video' | 'audio'
  modelFilterFunction: string
  favoriteModels: Set<string>
  onModelSelect: (providerId: string, modelId: string) => void
  onFilterProviderChange: (provider: string) => void
  onFilterTypeChange: (type: 'all' | 'favorite' | 'image' | 'video' | 'audio') => void
  onFilterFunctionChange: (func: string) => void
  onToggleFavorite: (e: React.MouseEvent, providerId: string, modelId: string) => void
}

/**
 * 模型选择面板
 * 从 MediaGenerator 中提取的模型选择UI（约90行）
 */
const ModelSelectorPanel: React.FC<ModelSelectorPanelProps> = ({
  selectedProvider,
  selectedModel,
  modelFilterProvider,
  modelFilterType,
  modelFilterFunction,
  favoriteModels,
  onModelSelect,
  onFilterProviderChange,
  onFilterTypeChange,
  onFilterFunctionChange,
  onToggleFavorite
}) => {
  // 直接从 localStorage 读取，每次渲染时都获取最新数据
  const [hiddenProviders, setHiddenProviders] = useState<Set<string>>(() => getHiddenProviders())
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(() => getHiddenTypes())
  const [hiddenModels, setHiddenModels] = useState<Set<string>>(() => getHiddenModels())

  useEffect(() => {
    // 每次组件挂载时重新加载数据（因为可能是下拉面板重新打开）
    setHiddenProviders(getHiddenProviders())
    setHiddenTypes(getHiddenTypes())
    setHiddenModels(getHiddenModels())

    // 监听模型可见性变化事件
    const handleVisibilityChange = () => {
      setHiddenProviders(getHiddenProviders())
      setHiddenTypes(getHiddenTypes())
      setHiddenModels(getHiddenModels())
    }

    window.addEventListener('modelVisibilityChanged', handleVisibilityChange)
    return () => {
      window.removeEventListener('modelVisibilityChanged', handleVisibilityChange)
    }
  }, [])

  // 获取过滤后的可见模型列表
  const visibleProviders = useMemo(() => {
    return getVisibleProviders(hiddenProviders, hiddenTypes, hiddenModels)
  }, [hiddenProviders, hiddenTypes, hiddenModels])

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 筛选区域 - 固定在顶部 */}
      <div className="flex-shrink-0 p-4 pb-0">
        {/* 供应商 / 类型筛选 */}
        <div className="mb-3">
          <div className="text-xs text-zinc-400 mb-2">供应商 / 类型</div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => onFilterProviderChange('all')} className={`px-3 py-2 text-xs rounded transition-all duration-300 ${modelFilterProvider === 'all' ? 'bg-[#007eff] text-white' : 'bg-zinc-700/50 text-zinc-300 hover:bg-zinc-600/50'}`}>全部</button>
            {providers.map(p => (
              <button key={p.id} onClick={() => onFilterProviderChange(p.id)} className={`px-3 py-2 text-xs rounded transition-all duration-300 ${modelFilterProvider === p.id ? 'bg-[#007eff] text-white' : 'bg-zinc-700/50 text-zinc-300 hover:bg-zinc-600/50'}`}>{p.name}</button>
            ))}
            <div className="w-px bg-zinc-600/50 mx-1"></div>
            {[
              { label: '全部', value: 'all' },
              { label: '收藏', value: 'favorite' },
              { label: '图片', value: 'image' },
              { label: '视频', value: 'video' },
              { label: '音频', value: 'audio' }
            ].map(t => {
              const isTypeHidden = t.value !== 'all' && t.value !== 'favorite' && hiddenTypes.has(t.value)
              return (
                <button
                  key={t.value}
                  onClick={() => onFilterTypeChange(t.value as any)}
                  className={`px-3 py-2 text-xs rounded transition-all duration-300 ${
                    modelFilterType === t.value
                      ? 'bg-[#007eff] text-white'
                      : isTypeHidden
                        ? 'opacity-40 bg-zinc-700/50 text-zinc-400 hover:bg-zinc-600/50'
                        : 'bg-zinc-700/50 text-zinc-300 hover:bg-zinc-600/50'
                  }`}
                >
                  {t.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* 功能筛选 */}
        <div className="mb-3">
          <div className="text-xs text-zinc-400 mb-2">功能</div>
          <div className="flex flex-wrap gap-2">
            {[
              { label: '全部', value: 'all' },
              { label: '图片生成', value: '图片生成' },
              { label: '图片编辑', value: '图片编辑' },
              { label: '文生视频', value: '文生视频' },
              { label: '图生视频', value: '图生视频' },
              { label: '首尾帧', value: '首尾帧' },
              { label: '参考生视频', value: '参考生视频' },
              { label: '视频编辑', value: '视频编辑' },
              { label: '视频延长', value: '视频延长' },
              { label: '语音合成', value: '语音合成' }
            ].map(f => (
              <button key={f.value} onClick={() => onFilterFunctionChange(f.value)} className={`px-3 py-2 text-xs rounded transition-all duration-300 ${modelFilterFunction === f.value ? 'bg-[#007eff] text-white' : 'bg-zinc-700/50 text-zinc-300 hover:bg-zinc-600/50'}`}>{f.label}</button>
            ))}
          </div>
        </div>
      </div>

      {/* 模型列表 - 可滚动区域 */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
          {visibleProviders
            .flatMap(p => p.models.map(m => ({ p, m })))
            .filter(item => (modelFilterProvider === 'all' ? true : item.p.id === modelFilterProvider))
            .filter(item => {
              if (modelFilterType === 'favorite') {
                return favoriteModels.has(`${item.p.id}-${item.m.id}`)
              }
              return modelFilterType === 'all' ? true : item.m.type === modelFilterType
            })
            .filter(item => (modelFilterFunction === 'all' ? true : item.m.functions.includes(modelFilterFunction)))
            .map(({ p, m }) => (
              <div key={`${p.id}-${m.id}`} data-close-on-select onClick={() => onModelSelect(p.id, m.id)} className={`relative px-3 py-3 cursor-pointer transition-colors duration-200 rounded-lg border ${selectedProvider === p.id && selectedModel === m.id ? 'bg-[#007eff]/20 text-[#66b3ff] border-[#007eff]/30' : 'bg-zinc-700/40 hover:bg-zinc-700/60 border-zinc-700/50'}`}>
                {/* 收藏按钮 */}
                <button
                  data-prevent-close
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onToggleFavorite(e, p.id, m.id)
                  }}
                  className="absolute top-1 right-1 p-1 rounded hover:bg-zinc-600/50 transition-colors z-10"
                  title={favoriteModels.has(`${p.id}-${m.id}`) ? '取消收藏' : '收藏模型'}
                >
                  <svg
                    className={`w-3.5 h-3.5 transition-all ${favoriteModels.has(`${p.id}-${m.id}`)
                      ? 'fill-yellow-400 text-yellow-400'
                      : 'fill-none text-zinc-500'
                      }`}
                    stroke="currentColor"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  </svg>
                </button>

                {/* 模型名称 */}
                <div className="text-sm mb-1 pr-6">{m.name}</div>

                {/* 底部信息行 */}
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-zinc-500">{p.name}</span>
                  <span className="text-zinc-400">{m.type === 'image' ? '图片' : m.type === 'video' ? '视频' : '音频'}</span>
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}

export default ModelSelectorPanel
