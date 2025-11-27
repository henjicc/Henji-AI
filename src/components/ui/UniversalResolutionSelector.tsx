import React from 'react'
import PanelTrigger from './PanelTrigger'
import { ResolutionConfig } from '@/types/schema'
import { calculateVisualizationSize } from '@/utils/aspectRatio'

interface UniversalResolutionSelectorProps {
  label?: string
  value: any
  options: Array<{ value: any; label: string }>
  config: ResolutionConfig
  customWidth?: string
  customHeight?: string
  qualityValue?: any
  onChange: (value: any) => void
  onWidthChange?: (value: string) => void
  onHeightChange?: (value: string) => void
  onQualityChange?: (value: any) => void
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
  onChange,
  onWidthChange,
  onHeightChange,
  onQualityChange
}) => {
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
          {/* 选择比例/尺寸/分辨率 */}
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
                  onClick={() => onChange(option.value)}
                  className={`px-2 py-3 ${config.type === 'resolution' ? 'text-sm' : 'text-xs'} rounded flex flex-col items-center justify-center gap-2 transition-all duration-300 ${
                    value === option.value
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

          {/* 质量选项（如 2K/4K 或 1K/2K/4K） */}
          {config.qualityOptions && onQualityChange && (
            <div className={config.customInput ? 'mb-3' : ''}>
              <label className="block text-xs text-zinc-400 mb-2">选择质量</label>
              <div className={`grid gap-2 ${
                config.qualityOptions.length === 2 ? 'grid-cols-2' : 'grid-cols-3'
              }`}>
                {config.qualityOptions.map(quality => (
                  <button
                    key={String(quality.value)}
                    onClick={() => onQualityChange(quality.value)}
                    className={`px-3 py-2 text-sm rounded transition-all duration-300 ${
                      qualityValue === quality.value
                        ? 'bg-[#007eff] text-white'
                        : 'bg-zinc-700/50 text-zinc-300 hover:bg-zinc-600/50'
                    }`}
                  >
                    {quality.label}
                  </button>
                ))}
              </div>
            </div>
          )}

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
