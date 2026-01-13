import React, { useState, useEffect, useMemo, useRef, useCallback, useLayoutEffect } from 'react'
import { providers, getHiddenProviders, getHiddenTypes, getHiddenModels, getVisibleProviders } from '@/config/providers'
import PinyinMatch from 'pinyin-match'

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
 * 计算搜索匹配分数
 * @param modelName 模型名称
 * @param query 搜索查询
 * @returns 匹配分数 (0 = 不匹配, 100 = 完全匹配)
 */
function calculateMatchScore(modelName: string, query: string): number {
  if (!query) return 100 // 空查询匹配所有

  const lowerName = modelName.toLowerCase()
  const lowerQuery = query.toLowerCase()

  // 完全匹配
  if (lowerName === lowerQuery) return 100

  // 开头匹配
  if (lowerName.startsWith(lowerQuery)) return 80

  // 包含匹配
  if (lowerName.includes(lowerQuery)) return 60

  // 拼音匹配 (pinyin-match 返回匹配位置数组或 false)
  const pinyinResult = PinyinMatch.match(modelName, query)
  if (pinyinResult) return 40

  // 不匹配
  return 0
}

// 网格列数配置（与 CSS grid-cols 保持一致）
const GRID_COLUMNS = {
  default: 2,
  sm: 3,
  lg: 4,
  xl: 5
}

/**
 * 模型选择面板
 * 从 MediaGenerator 中提取的模型选择UI
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

  // 搜索状态
  const [searchQuery, setSearchQuery] = useState('')

  // 键盘导航状态
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const gridContainerRef = useRef<HTMLDivElement>(null)
  const highlightedItemRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // 获取当前网格列数
  const getColumnsCount = useCallback(() => {
    if (typeof window === 'undefined') return GRID_COLUMNS.default
    const width = window.innerWidth
    if (width >= 1280) return GRID_COLUMNS.xl
    if (width >= 1024) return GRID_COLUMNS.lg
    if (width >= 640) return GRID_COLUMNS.sm
    return GRID_COLUMNS.default
  }, [])

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

  // 组件挂载时自动聚焦搜索框
  useEffect(() => {
    // 检查是否开启了自动聚焦配置（默认开启）
    const shouldAutoFocusSearch = localStorage.getItem('enable_auto_focus_model_search') !== 'false'

    // 使用 setTimeout 确保在 DOM 渲染完成后聚焦
    const timer = setTimeout(() => {
      if (shouldAutoFocusSearch) {
        searchInputRef.current?.focus()
      } else {
        // 如果不聚焦搜索框，则聚焦面板容器，以确保键盘导航（方向键）可用
        wrapperRef.current?.focus()
      }
    }, 50)
    return () => clearTimeout(timer)
  }, [])

  // 获取过滤后的可见模型列表
  const visibleProviders = useMemo(() => {
    return getVisibleProviders(hiddenProviders, hiddenTypes, hiddenModels)
  }, [hiddenProviders, hiddenTypes, hiddenModels])

  // 过滤并排序后的模型列表
  const filteredAndSortedModels = useMemo(() => {
    const items = visibleProviders
      .flatMap(p => p.models.map(m => ({ p, m })))
      .filter(item => (modelFilterProvider === 'all' ? true : item.p.id === modelFilterProvider))
      .filter(item => {
        if (modelFilterType === 'favorite') {
          return favoriteModels.has(`${item.p.id}-${item.m.id}`)
        }
        return modelFilterType === 'all' ? true : item.m.type === modelFilterType
      })
      .filter(item => (modelFilterFunction === 'all' ? true : item.m.functions.includes(modelFilterFunction)))

    // 如果有搜索查询，计算分数并过滤/排序
    if (searchQuery.trim()) {
      return items
        .map(item => ({
          ...item,
          score: calculateMatchScore(item.m.name, searchQuery.trim())
        }))
        .filter(item => item.score > 0)
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score
          // 分数相同，按名称排序，确保顺序稳定
          return a.m.name.localeCompare(b.m.name)
        })
    }

    return items.map(item => ({ ...item, score: 100 }))
  }, [visibleProviders, modelFilterProvider, modelFilterType, modelFilterFunction, favoriteModels, searchQuery])

  // 当筛选条件变化时，重置高亮索引
  // 使用 useLayoutEffect 避免渲染闪烁（即先用旧 index 渲染了新列表）
  useLayoutEffect(() => {
    // 尝试在过滤后的列表中找到当前选中的模型
    const index = filteredAndSortedModels.findIndex(
      item => item.p.id === selectedProvider && item.m.id === selectedModel
    )
    // 如果找到了，就定位到它；否则定位到第一个
    setHighlightedIndex(index >= 0 ? index : 0)
  }, [searchQuery, modelFilterProvider, modelFilterType, modelFilterFunction, filteredAndSortedModels, selectedProvider, selectedModel])

  // 确保高亮索引在有效范围内
  useEffect(() => {
    if (highlightedIndex >= filteredAndSortedModels.length && filteredAndSortedModels.length > 0) {
      setHighlightedIndex(filteredAndSortedModels.length - 1)
    }
  }, [filteredAndSortedModels.length, highlightedIndex])

  // 滚动高亮项到可视区域
  useEffect(() => {
    if (highlightedItemRef.current && gridContainerRef.current) {
      highlightedItemRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
      })
    }
  }, [highlightedIndex])

  // 键盘导航处理
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const totalItems = filteredAndSortedModels.length
    if (totalItems === 0) return

    const columns = getColumnsCount()

    switch (e.key) {
      case 'ArrowUp': {
        e.preventDefault()
        setHighlightedIndex(prev => {
          const newIndex = prev - columns
          return newIndex >= 0 ? newIndex : prev
        })
        break
      }
      case 'ArrowDown': {
        e.preventDefault()
        setHighlightedIndex(prev => {
          const newIndex = prev + columns
          return newIndex < totalItems ? newIndex : prev
        })
        break
      }
      case 'ArrowLeft': {
        e.preventDefault()
        setHighlightedIndex(prev => (prev > 0 ? prev - 1 : prev))
        break
      }
      case 'ArrowRight': {
        e.preventDefault()
        setHighlightedIndex(prev => (prev < totalItems - 1 ? prev + 1 : prev))
        break
      }
      case 'Enter': {
        e.preventDefault()
        // 模拟点击高亮项，这样会触发 data-close-on-select 关闭面板
        // 注意：PanelTrigger 监听的是 mousedown 事件来判断是否关闭
        if (highlightedItemRef.current) {
          // 1. 触发 PanelTrigger 的关闭逻辑 (它监听 document mousedown)
          highlightedItemRef.current.dispatchEvent(new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            view: window
          }))
          // 2. 触发选择逻辑
          highlightedItemRef.current.click()
        } else {
          const highlightedItem = filteredAndSortedModels[highlightedIndex]
          if (highlightedItem) {
            onModelSelect(highlightedItem.p.id, highlightedItem.m.id)
          }
        }
        break
      }
    }
  }, [filteredAndSortedModels, highlightedIndex, getColumnsCount, onModelSelect])

  return (
    <div
      ref={wrapperRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className="flex flex-col h-full min-h-0 outline-none"
    >
      {/* 筛选区域 - 固定在顶部 */}
      <div className="flex-shrink-0 p-4 pb-0">
        {/* 搜索框 */}
        <div className="mb-3">
          <div className="text-xs text-zinc-400 mb-2">搜索</div>
          <div className="relative">
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="输入模型名称、拼音或首字母..."
              className="w-full px-3 py-2 text-sm bg-zinc-800/70 backdrop-blur-lg border border-zinc-700/50 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:ring-inset focus:ring-2 focus:ring-[#007eff]/60 focus:ring-offset-0 focus:ring-offset-transparent focus:border-[#007eff] transition-shadow duration-300 ease-out"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-zinc-600/50 transition-colors"
                title="清除搜索"
              >
                <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

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
                  className={`px-3 py-2 text-xs rounded transition-all duration-300 ${modelFilterType === t.value
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
              { label: '动作控制', value: '动作控制' },
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
      <div ref={gridContainerRef} className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
          {filteredAndSortedModels.map(({ p, m }, index) => {
            const isHighlighted = index === highlightedIndex

            return (
              <div
                key={`${p.id}-${m.id}`}
                ref={isHighlighted ? highlightedItemRef : null}
                data-close-on-select
                onClick={() => onModelSelect(p.id, m.id)}
                className={`relative px-3 py-3 cursor-pointer transition-colors duration-200 rounded-lg border ${isHighlighted
                  ? 'bg-[#007eff]/20 text-[#66b3ff] border-[#007eff]/60 ring-1 ring-[#007eff]/60'
                  : 'bg-zinc-700/40 hover:bg-zinc-700/60 border-zinc-700/50'
                  }`}
              >
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
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default ModelSelectorPanel


