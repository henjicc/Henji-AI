import React, { useEffect } from 'react'
import PanelTrigger from './PanelTrigger'
import { ResolutionConfig } from '@/types/schema'
import { calculateVisualizationSize } from '@/utils/aspectRatio'

interface UniversalResolutionSelectorProps {
  label?: string
  value: any
  options: Array<{ value: any; label: string; disabled?: boolean }>
  config: ResolutionConfig
  customWidth?: string
  customHeight?: string
  qualityValue?: any
  baseSizeValue?: number  // 新增：基数值
  values?: Record<string, any>  // 新增：完整的参数值对象，用于 hideAspectRatio 判断
  onChange: (value: any) => void
  onWidthChange?: (value: string) => void
  onHeightChange?: (value: string) => void
  onQualityChange?: (value: any) => void
  onBaseSizeChange?: (value: number) => void  // 新增：基数变化回调
}

/**
 * 通用分辨率选择器
 * 支持三种类型：宽高比（aspect_ratio）、尺寸（size）、分辨率（resolution）
 * 可配置是否显示可视化图标、自定义输入、质量选项等
 */
const UniversalResolutionSelector: React.FC<UniversalResolutionSelectorProps> = ({
  label,
  value,
  options,
  config,
  customWidth,
  customHeight,
  qualityValue,
  baseSizeValue,
  values: _values,
  onChange,
  onWidthChange,
  onHeightChange,
  onQualityChange,
  onBaseSizeChange
}) => {
  // 获取基数配置（使用默认值）
  const baseSize = baseSizeValue || config.baseSize || 1440
  const baseSizeEditable = config.baseSizeEditable === true // 默认不允许编辑，只有明确设置为 true 时才显示
  const baseSizeMin = config.baseSizeMin || 512
  const baseSizeMax = config.baseSizeMax || 2048

  // 当宽高比变化时，自动更新自定义尺寸
  useEffect(() => {
    // 只在以下条件下自动更新：
    // 1. 启用了自定义输入
    // 2. 有宽高变化回调
    // 3. 当前值不是智能模式
    // 4. 当前值是宽高比格式
    if (!config.customInput || !onWidthChange || !onHeightChange) return
    if (value === 'smart' || value === 'auto' || value === '智能') return
    if (!value || !value.includes(':')) return

    const [w, h] = value.split(':').map(Number)
    if (isNaN(w) || isNaN(h)) return

    // ⚠️ 性能优化：避免不必要的计算
    // 只有当真正影响计算结果的参数变化时才重新计算

    // 使用即梦专用计算器（如果启用）
    if (config.useSeedreamCalculator) {
      // 即梦模型：根据质量模式（2K/4K）和宽高比计算分辨率
      const quality = qualityValue || '2K'
      const targetPixels = quality === '2K' ? 4194304 : 16777216 // 2K: 2048*2048, 4K: 4096*4096
      const aspectRatio = w / h
      const provider = config.seedreamProvider || 'fal'

      // 根据提供商设置约束条件
      const constraints = provider === 'ppio'
        ? {
            minRatio: 1/16,
            maxRatio: 16,
            absoluteMaxPixels: 16777216, // 派欧云：严格不超过 4096*4096
            allowOvershoot: false,       // 派欧云：不允许超过目标像素
            name: '派欧云'
          }
        : {
            minRatio: 1/3,
            maxRatio: 3,
            absoluteMaxPixels: 36000000, // fal.ai：不超过 6000*6000
            allowOvershoot: true,        // fal.ai：允许超过目标像素5%
            name: 'fal.ai'
          }

      // 计算能达到目标像素数的理想尺寸
      const targetHeight = Math.sqrt(targetPixels / aspectRatio)
      const targetWidth = targetHeight * aspectRatio

      // 取整（不强制8的倍数，以获得更精确的比例匹配）
      let width = Math.round(targetWidth)
      let height = Math.round(targetHeight)

      // 确保不小于目标像素数
      let currentPixels = width * height
      const maxAllowedPixels = constraints.allowOvershoot
        ? Math.min(targetPixels * 1.05, constraints.absoluteMaxPixels)
        : Math.min(targetPixels, constraints.absoluteMaxPixels)

      while (currentPixels < targetPixels && currentPixels < maxAllowedPixels) {
        const withExtraWidth = (width + 1) * height
        const withExtraHeight = width * (height + 1)

        if (withExtraWidth <= maxAllowedPixels && withExtraHeight <= maxAllowedPixels) {
          if (Math.abs(withExtraWidth - targetPixels) < Math.abs(withExtraHeight - targetPixels)) {
            width += 1
            currentPixels = withExtraWidth
          } else {
            height += 1
            currentPixels = withExtraHeight
          }
        } else if (withExtraWidth <= maxAllowedPixels) {
          width += 1
          currentPixels = withExtraWidth
        } else if (withExtraHeight <= maxAllowedPixels) {
          height += 1
          currentPixels = withExtraHeight
        } else {
          break
        }
      }

      // 确保不超过最大允许像素
      if (currentPixels > maxAllowedPixels) {
        const scale = Math.sqrt(maxAllowedPixels / currentPixels)
        width = Math.round(width * scale)
        height = Math.round(height * scale)
      }

      // 确保最小尺寸（至少15像素）
      if (width < 15) width = 15
      if (height < 15) height = 15

      // 最终验证宽高比是否在范围内
      const finalRatio = width / height
      if (finalRatio >= constraints.minRatio && finalRatio <= constraints.maxRatio) {
        onWidthChange(String(width))
        onHeightChange(String(height))

        console.log(`[UniversalResolutionSelector] ${constraints.name}即梦分辨率计算:`, {
          提供商: provider,
          比例: `${w}:${h}`,
          质量模式: quality,
          目标像素: targetPixels,
          计算结果: `${width}x${height}`,
          实际像素: width * height,
          利用率: `${((width * height / targetPixels) * 100).toFixed(2)}%`,
          宽高比范围: `[${constraints.minRatio}, ${constraints.maxRatio}]`,
          最大像素限制: constraints.absoluteMaxPixels
        })
      } else {
        console.warn(`[UniversalResolutionSelector] 宽高比 ${finalRatio.toFixed(4)} 超出 ${constraints.name} 允许范围 [${constraints.minRatio}, ${constraints.maxRatio}]`)
      }
    }
    // 使用 Qwen 计算器（如果启用）
    else if (config.useQwenCalculator) {
      import('@/utils/qwenResolutionCalculator').then(({ calculateQwenResolution }) => {
        const size = calculateQwenResolution(w, h)
        onWidthChange(String(size.width))
        onHeightChange(String(size.height))
      })
    }
    // 使用基数系统计算器
    else {
      import('@/utils/resolutionCalculator').then(({ calculateResolution }) => {
        const size = calculateResolution(baseSize, w, h)
        onWidthChange(String(size.width))
        onHeightChange(String(size.height))
      })
    }
  }, [
    value,                              // 宽高比变化时重新计算
    baseSize,                           // 基数变化时重新计算（基数系统）
    qualityValue,                       // 质量模式变化时重新计算（即梦/Qwen）
    config.customInput,                 // 配置变化
    config.useQwenCalculator,           // 计算器类型变化
    config.useSeedreamCalculator,       // 计算器类型变化
    config.seedreamProvider             // 即梦提供商变化（fal/ppio）
    // ⚠️ 注意：不要添加 onWidthChange 和 onHeightChange 到依赖数组
    // 这两个回调函数的引用会频繁变化，但不影响计算结果
    // 添加它们会导致每次父组件渲染都触发重新计算，严重影响性能
  ])
  // 自动判断标签：如果只有宽高比（没有质量选项和自定义输入），显示"比例"，否则显示"分辨率"
  const getDefaultLabel = () => {
    if (config.type === 'aspect_ratio' && !config.qualityOptions && !config.customInput) {
      return '比例'
    }
    return '分辨率'
  }

  const displayLabel = label || getDefaultLabel()

  // 获取显示文本
  const getDisplayText = () => {
    if (value === 'auto' || value === '智能') return '智能'

    // 如果没有比例选项（图生视频模式），显示质量值
    if (options.length === 0 && config.qualityOptions && qualityValue) {
      const qualityOpts = typeof config.qualityOptions === 'function'
        ? config.qualityOptions(_values)
        : config.qualityOptions
      const qualityOption = qualityOpts.find((opt: any) => opt.value === qualityValue)
      if (qualityOption) {
        return qualityOption.label
      }
    }

    // 否则显示比例值
    const option = options.find(opt => opt.value === value)
    return option?.label || value
  }

  // 渲染可视化图标（用于宽高比和尺寸类型）
  const renderVisualization = (optionValue: any) => {
    if (!config.visualize) return null
    if (config.type === 'resolution') return null // 分辨率类型不显示图标

    const ratio = config.extractRatio?.(optionValue)
    if (ratio === null || ratio === undefined) {
      // 智能模式，显示闪电图标
      return (
        <div className="flex items-center justify-center h-8">
          <svg className="w-6 h-6 text-yellow-400" fill="currentColor" viewBox="0 0 24 24">
            <path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z" />
          </svg>
        </div>
      )
    }

    // 计算可视化尺寸
    const size = calculateVisualizationSize(ratio, 32)
    return (
      <div className="flex items-center justify-center h-8">
        <div
          className="border-2 border-white"
          style={{
            width: `${size.width}px`,
            height: `${size.height}px`
          }}
        ></div>
      </div>
    )
  }

  // 根据类型计算面板宽度
  const getPanelWidth = () => {
    if (config.customInput) return 320
    if (config.type === 'size') return 400  // 尺寸类型需要更宽的面板来显示完整数值
    return 280
  }

  return (
    <PanelTrigger
      label={displayLabel}
      display={getDisplayText()}
      className="w-auto"
      panelWidth={getPanelWidth()}
      alignment="aboveCenter"
      closeOnPanelClick={false}
      renderPanel={() => (
        <div className="p-4">
          {/* 基数输入框（仅在 baseSizeEditable 为 true 时显示） */}
          {baseSizeEditable && onBaseSizeChange && (
            <div className="mb-3">
              <label className="block text-xs text-zinc-400 mb-2">
                基数（正方形边长）
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={baseSize}
                  onChange={(e) => {
                    const value = e.target.value
                    if (value === '') {
                      onBaseSizeChange(baseSizeMin)
                    } else {
                      const numValue = parseInt(value)
                      if (!isNaN(numValue)) {
                        onBaseSizeChange(numValue)
                      }
                    }
                  }}
                  className="flex-1 bg-zinc-700/50 border border-zinc-700/50 rounded px-3 py-2 text-sm"
                />
                <span className="text-xs text-zinc-400 whitespace-nowrap">PX</span>
              </div>
              <div className="text-[11px] text-zinc-500 mt-1">
                推荐范围：{baseSizeMin}-{baseSizeMax} PX
              </div>
            </div>
          )}

          {/* 选择比例/尺寸/分辨率 */}
          {/* 当 options 为空时，隐藏此部分 */}
          {options.length > 0 && (
            <div className={config.qualityOptions || config.customInput ? 'mb-3' : ''}>
              <label className="block text-xs text-zinc-400 mb-2">
                {config.type === 'aspect_ratio' ? '选择比例' :
                 config.type === 'size' ? '选择尺寸' :
                 '选择分辨率'}
              </label>
              <div className={`grid gap-2 ${
                config.type === 'resolution' ? 'grid-cols-3' : 'grid-cols-4'
              }`}>
                {options.map(option => (
                  <button
                    key={String(option.value)}
                    onClick={() => {
                      if (option.disabled) return
                      onChange(option.value)
                    }}
                    disabled={option.disabled}
                    className={`px-2 py-3 ${config.type === 'resolution' ? 'text-sm' : 'text-xs'} rounded flex flex-col items-center justify-center gap-2 transition-all duration-300 ${
                      option.disabled
                        ? 'opacity-50 cursor-not-allowed bg-zinc-700/30'
                        : value === option.value
                          ? 'bg-[#007eff] text-white'
                          : 'bg-zinc-700/50 text-zinc-300 hover:bg-zinc-600/50'
                    }`}
                  >
                    {config.visualize && config.type !== 'resolution' && renderVisualization(option.value)}
                    <span className="font-medium">{option.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 质量选项（如 2K/4K 或 1K/2K/4K） */}
          {config.qualityOptions && onQualityChange && (() => {
            const qualityOpts = typeof config.qualityOptions === 'function'
              ? config.qualityOptions(_values)
              : config.qualityOptions
            return (
              <div className={config.customInput ? 'mb-3' : ''}>
                {/* 只有当同时有比例选项时才显示"选择质量"标签 */}
                {options.length > 0 && (
                  <label className="block text-xs text-zinc-400 mb-2">选择质量</label>
                )}
                <div className={`grid gap-2 ${
                  qualityOpts.length === 2 ? 'grid-cols-2' : 'grid-cols-3'
                }`}>
                  {qualityOpts.map((quality: any) => (
                  <button
                    key={String(quality.value)}
                    onClick={() => {
                      if ((quality as any).disabled) return
                      onQualityChange(quality.value)
                    }}
                    disabled={(quality as any).disabled}
                    className={`px-3 py-2 text-sm rounded transition-all duration-300 ${
                      (quality as any).disabled
                        ? 'opacity-50 cursor-not-allowed bg-zinc-700/30'
                        : qualityValue === quality.value
                          ? 'bg-[#007eff] text-white'
                          : 'bg-zinc-700/50 text-zinc-300 hover:bg-zinc-600/50'
                    }`}
                  >
                    {quality.label}
                  </button>
                ))}
              </div>
            </div>
          )
          })()}

          {/* 自定义尺寸输入 */}
          {config.customInput && onWidthChange && onHeightChange && (
            <div>
              <label className="block text-xs text-zinc-400 mb-2">自定义尺寸</label>
              <div className="flex gap-2 items-center">
                <div className="flex-1">
                  <input
                    type="number"
                    value={customWidth}
                    onChange={(e) => onWidthChange(e.target.value)}
                    disabled={value === 'smart' || value === 'auto' || value === '智能'}
                    placeholder="2048"
                    className={`w-full bg-zinc-700/50 border border-zinc-700/50 rounded px-3 py-2 text-sm ${
                      value === 'smart' || value === 'auto' || value === '智能' ? 'opacity-50 cursor-not-allowed' : ''
                    }`}
                    min="512"
                    max="8192"
                  />
                </div>
                <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"></path>
                </svg>
                <div className="flex-1">
                  <input
                    type="number"
                    value={customHeight}
                    onChange={(e) => onHeightChange(e.target.value)}
                    disabled={value === 'smart' || value === 'auto' || value === '智能'}
                    placeholder="2048"
                    className={`w-full bg-zinc-700/50 border border-zinc-700/50 rounded px-3 py-2 text-sm ${
                      value === 'smart' || value === 'auto' || value === '智能' ? 'opacity-50 cursor-not-allowed' : ''
                    }`}
                    min="512"
                    max="8192"
                  />
                </div>
                <span className="text-xs text-zinc-400">PX</span>
              </div>
            </div>
          )}
        </div>
      )}
    />
  )
}

export default UniversalResolutionSelector
