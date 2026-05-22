/**
 * ResolutionPanel - 分辨率面板主组件
 *
 * 支持三种模式：
 * - aspect-quality: 比例 + 质量档位
 * - preset: 预设分辨率
 * - custom: 自定义尺寸
 * - hybrid: 混合模式（比例 + 质量 + 自定义）
 */

import React from 'react'
import { AspectRatioSelector } from './AspectRatioSelector'
import { QualityTierSelector } from './QualityTierSelector'
import { CustomSizeInput } from './CustomSizeInput'
import { PresetResolutionSelector } from './PresetResolutionSelector'
import type { ResolutionConfig, ResolutionValue } from './types'
import './styles.css'

export interface ResolutionPanelProps {
  value: ResolutionValue
  onChange: (value: ResolutionValue) => void
  config: ResolutionConfig
}

export const ResolutionPanel: React.FC<ResolutionPanelProps> = ({
  value,
  onChange,
  config
}) => {
  // Mode A: 比例 + 质量
  if (config.mode === 'aspect-quality' || config.mode === 'hybrid') {
    return (
      <div className="p-4 flex flex-col gap-4">
        {config.aspectRatios && (
          <AspectRatioSelector
            value={value.aspectRatio || config.aspectRatios.default}
            onChange={(aspectRatio) => onChange({ ...value, mode: config.mode, aspectRatio })}
            options={config.aspectRatios.options}
            visualize={true}
            smartMatchEnabled={config.aspectRatios.smartMatch}
          />
        )}

        {config.qualityTiers && (
          <QualityTierSelector
            value={value.quality || config.qualityTiers.default}
            onChange={(quality) => onChange({ ...value, mode: config.mode, quality })}
            options={config.qualityTiers.options}
            availableFor={value.aspectRatio}
            availableForMap={config.qualityTiers.availableFor}
          />
        )}

        {config.mode === 'hybrid' && config.customSize?.enabled && (
          <CustomSizeInput
            value={{
              width: value.width || 1280,
              height: value.height || 720
            }}
            onChange={({ width, height }) => onChange({ ...value, mode: config.mode, width, height })}
            minWidth={config.customSize.minWidth}
            maxWidth={config.customSize.maxWidth}
            minHeight={config.customSize.minHeight}
            maxHeight={config.customSize.maxHeight}
            step={config.customSize.step}
            lockRatio={config.customSize.lockRatio}
            disabled={value.aspectRatio === 'smart'}
          />
        )}
      </div>
    )
  }

  // Mode B: 预设分辨率
  if (config.mode === 'preset' && config.presets) {
    return (
      <div className="p-4 flex flex-col gap-4">
        <PresetResolutionSelector
          value={value.preset || config.presets.default}
          onChange={(preset) => onChange({ ...value, mode: config.mode, preset })}
          options={config.presets.options}
        />
      </div>
    )
  }

  // Mode C: 纯自定义
  if (config.mode === 'custom' && config.customSize) {
    return (
      <div className="p-4 flex flex-col gap-4">
        <CustomSizeInput
          value={{
            width: value.width || 1280,
            height: value.height || 720
          }}
          onChange={({ width, height }) => onChange({ ...value, mode: config.mode, width, height })}
          minWidth={config.customSize.minWidth}
          maxWidth={config.customSize.maxWidth}
          minHeight={config.customSize.minHeight}
          maxHeight={config.customSize.maxHeight}
          step={config.customSize.step}
          lockRatio={config.customSize.lockRatio}
        />
      </div>
    )
  }

  return null
}
