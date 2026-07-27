import { createLogger } from '@/core/logging'
import React, { useEffect } from 'react'
import PanelTrigger from './PanelTrigger'
import { ResolutionConfig } from '@/types/schema'
import { formatAspectRatioDisplayLabel } from '@/core/params/ratioResolution'
import { calculateVisualizationSize } from '@/utils/aspectRatio'
import { useI18n } from '@/hooks/useI18n'
import { UI_TEXT_LABEL_CLASS, UI_TEXT_META_CLASS, UiInput, UiOptionButton } from '@/components/ui'

const logger = createLogger('components.ui.UniversalResolutionSelector')

type SelectorOption = { value: DynamicValue; label: string; disabled?: boolean }

interface UniversalResolutionSelectorProps {
  label?: string
  value: DynamicValue
  options: SelectorOption[]
  config: ResolutionConfig
  customWidth?: string
  customHeight?: string
  qualityValue?: DynamicValue
  baseSizeValue?: number
  values?: DynamicValueMap
  onChange: (value: DynamicValue) => void
  onWidthChange?: (value: string) => void
  onHeightChange?: (value: string) => void
  onQualityChange?: (value: DynamicValue) => void
  onBaseSizeChange?: (value: number) => void
}

const SMART_VALUES = new Set(['smart', 'auto', '智能'])

function isSmartValue(value: DynamicValue): boolean {
  return typeof value === 'string' && SMART_VALUES.has(value)
}

function parseRatio(value: DynamicValue): { width: number; height: number } | null {
  if (typeof value !== 'string' || isSmartValue(value) || !value.includes(':')) {
    return null
  }

  const [width, height] = value.split(':').map(Number)
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null
  }

  return { width, height }
}

function resolveQualityOptions(config: ResolutionConfig, values?: DynamicValueMap): SelectorOption[] {
  if (!config.qualityOptions) {
    return []
  }

  const rawOptions = typeof config.qualityOptions === 'function'
    ? config.qualityOptions(values)
    : config.qualityOptions

  return rawOptions.map((option) => ({
    value: option.value,
    label: option.label,
    disabled: 'disabled' in option && option.disabled === true,
  }))
}

function shouldHideAspectRatio(config: ResolutionConfig, values?: DynamicValueMap): boolean {
  if (!config.hideAspectRatio) {
    return false
  }

  return typeof config.hideAspectRatio === 'function'
    ? config.hideAspectRatio(values)
    : Boolean(config.hideAspectRatio)
}

function resolvePanelWidth(config: ResolutionConfig): number {
  if (config.customInput) return 320
  if (config.type === 'size') return 400
  return 280
}

const UniversalResolutionSelector: React.FC<UniversalResolutionSelectorProps> = ({
  label,
  value,
  options,
  config,
  customWidth,
  customHeight,
  qualityValue,
  baseSizeValue,
  values,
  onChange,
  onWidthChange,
  onHeightChange,
  onQualityChange,
  onBaseSizeChange,
}) => {
  const { t } = useI18n('ui')
  const baseSize = baseSizeValue || config.baseSize || 1440
  const baseSizeEditable = config.baseSizeEditable === true
  const baseSizeMin = config.baseSizeMin || 512
  const baseSizeMax = config.baseSizeMax || 2048
  const hideAspectRatio = shouldHideAspectRatio(config, values)
  const qualityOptions = resolveQualityOptions(config, values)
  const qualityColumnsClass = qualityOptions.length === 2 ? 'grid-cols-2' : 'grid-cols-3'

  useEffect(() => {
    if (!config.customInput || !onWidthChange || !onHeightChange) return

    const ratio = parseRatio(value)
    if (!ratio) return

    if (config.useSeedreamCalculator) {
      const quality = qualityValue === '4K' ? '4K' : '2K'
      const targetPixels = quality === '2K' ? 4194304 : 16777216
      const aspectRatio = ratio.width / ratio.height
      const provider = config.seedreamProvider || 'fal'
      const constraints = provider === 'ppio'
        ? {
            minRatio: 1 / 16,
            maxRatio: 16,
            absoluteMaxPixels: 16777216,
            allowOvershoot: false,
            name: '派欧云',
          }
        : {
            minRatio: 1 / 3,
            maxRatio: 3,
            absoluteMaxPixels: 36000000,
            allowOvershoot: true,
            name: 'fal.ai',
          }

      const targetHeight = Math.sqrt(targetPixels / aspectRatio)
      const targetWidth = targetHeight * aspectRatio
      let width = Math.max(15, Math.round(targetWidth))
      let height = Math.max(15, Math.round(targetHeight))
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

      if (currentPixels > maxAllowedPixels) {
        const scale = Math.sqrt(maxAllowedPixels / currentPixels)
        width = Math.max(15, Math.round(width * scale))
        height = Math.max(15, Math.round(height * scale))
      }

      const finalRatio = width / height
      if (finalRatio >= constraints.minRatio && finalRatio <= constraints.maxRatio) {
        onWidthChange(String(width))
        onHeightChange(String(height))
        logger.info(`[UniversalResolutionSelector] ${constraints.name}即梦分辨率计算:`, {
          提供商: provider,
          比例: `${ratio.width}:${ratio.height}`,
          质量模式: quality,
          目标像素: targetPixels,
          计算结果: `${width}x${height}`,
          实际像素: width * height,
          利用率: `${((width * height / targetPixels) * 100).toFixed(2)}%`,
        })
      } else {
        logger.warn(
          `[UniversalResolutionSelector] 宽高比 ${finalRatio.toFixed(4)} 超出 ${constraints.name} 允许范围 [${constraints.minRatio}, ${constraints.maxRatio}]`,
          {}
        )
      }
      return
    }

    if (config.useQwenCalculator) {
      import('@/utils/qwenResolutionCalculator').then(({ calculateQwenResolution }) => {
        const size = calculateQwenResolution(ratio.width, ratio.height)
        onWidthChange(String(size.width))
        onHeightChange(String(size.height))
      })
      return
    }

    import('@/utils/resolutionCalculator').then(({ calculateResolution }) => {
      const size = calculateResolution(baseSize, ratio.width, ratio.height)
      onWidthChange(String(size.width))
      onHeightChange(String(size.height))
    })
  }, [value, baseSize, qualityValue, config.customInput, config.useQwenCalculator, config.useSeedreamCalculator, config.seedreamProvider, onWidthChange, onHeightChange])

  const displayLabel = label || (
    config.type === 'aspect_ratio' && !config.qualityOptions && !config.customInput
      ? t('resolutionPanel.aspectRatioShort')
      : t('resolutionPanel.label')
  )

  const displayText = (() => {
    if (isSmartValue(value)) return t('resolutionPanel.smart')

    if (hideAspectRatio && qualityOptions.length > 0 && qualityValue !== undefined) {
      const match = qualityOptions.find((item) => item.value === qualityValue)
      if (match) return match.label
    }

    const selected = options.find((item) => item.value === value)
    if (config.type === 'aspect_ratio') {
      return formatAspectRatioDisplayLabel(
        selected?.label || String(value ?? ''),
        value
      )
    }

    return selected?.label || String(value ?? '')
  })()

  const renderVisualization = (optionValue: DynamicValue) => {
    if (!config.visualize || config.type === 'resolution') {
      return null
    }

    const ratio = config.extractRatio?.(optionValue)
    if (ratio === null || ratio === undefined) {
      return (
        <div className="flex items-center justify-center h-8">
          <svg className="w-6 h-6 text-yellow-400" fill="currentColor" viewBox="0 0 24 24">
            <path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z" />
          </svg>
        </div>
      )
    }

    const size = calculateVisualizationSize(ratio, 32)
    return (
      <div className="flex items-center justify-center h-8">
        <div className="border-2 border-white" style={{ width: `${size.width}px`, height: `${size.height}px` }} />
      </div>
    )
  }

  const customInputDisabled = isSmartValue(value)

  return (
    <PanelTrigger
      label={displayLabel}
      display={displayText}
      className="w-auto"
      panelWidth={resolvePanelWidth(config)}
      alignment="aboveCenter"
      closeOnPanelClick={false}
      renderPanel={() => (
        <div className="p-4">
          {baseSizeEditable && onBaseSizeChange && (
            <div className="mb-3">
              <label className={`mb-2 block ${UI_TEXT_LABEL_CLASS}`}>{t('resolutionPanel.baseSizeLabel')}</label>
              <div className="flex items-center gap-2">
                <UiInput
                  type="number"
                  value={baseSize}
                  onChange={(event) => {
                    const next = event.target.value
                    if (!next) {
                      onBaseSizeChange(baseSizeMin)
                      return
                    }
                    const parsed = parseInt(next, 10)
                    if (!Number.isNaN(parsed)) {
                      onBaseSizeChange(parsed)
                    }
                  }}
                  className="h-9"
                />
                <span className="text-xs text-text-muted whitespace-nowrap">PX</span>
              </div>
              <div className={`mt-1 ${UI_TEXT_META_CLASS}`}>
                {t('resolutionPanel.baseSizeHint', { min: baseSizeMin, max: baseSizeMax })}
              </div>
            </div>
          )}

          {!hideAspectRatio && options.length > 0 && (
            <div className={config.qualityOptions || config.customInput ? 'mb-3' : ''}>
              <label className={`mb-2 block ${UI_TEXT_LABEL_CLASS}`}>
                {config.type === 'aspect_ratio'
                  ? t('resolutionPanel.aspectRatioLabel')
                  : config.type === 'size'
                    ? t('resolutionPanel.sizeSelectLabel')
                    : t('resolutionPanel.qualityLabel')}
              </label>
              <div className={`grid gap-2 ${config.type === 'resolution' ? 'grid-cols-3' : 'grid-cols-4'}`}>
                {options.map((option) => (
                  <UiOptionButton
                    key={String(option.value)}
                    type="button"
                    active={value === option.value}
                    variant="menu"
                    disabled={option.disabled}
                    onClick={() => {
                      if (!option.disabled) {
                        onChange(option.value)
                      }
                    }}
                    className={`px-2 py-3 ${config.type === 'resolution' ? 'text-sm' : 'text-xs'} flex-col justify-center gap-2 ${
                      value === option.value ? '' : 'bg-veil-faint'
                    } ${option.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {config.visualize && config.type !== 'resolution' && renderVisualization(option.value)}
                    <span className="font-medium">
                      {config.type === 'aspect_ratio'
                        ? formatAspectRatioDisplayLabel(option.label, option.value)
                        : option.label}
                    </span>
                  </UiOptionButton>
                ))}
              </div>
            </div>
          )}

          {qualityOptions.length > 0 && onQualityChange && (
            <div className={config.customInput ? 'mb-3' : ''}>
              {!hideAspectRatio && options.length > 0 && (
                <label className={`mb-2 block ${UI_TEXT_LABEL_CLASS}`}>{t('resolutionPanel.qualitySelectLabel')}</label>
              )}
              <div className={`grid gap-2 ${qualityColumnsClass}`}>
                {qualityOptions.map((quality) => (
                  <UiOptionButton
                    key={String(quality.value)}
                    type="button"
                    active={qualityValue === quality.value}
                    variant="menu"
                    disabled={quality.disabled}
                    onClick={() => {
                      if (!quality.disabled) {
                        onQualityChange(quality.value)
                      }
                    }}
                    className={`px-3 py-2 text-sm justify-center ${
                      qualityValue === quality.value ? '' : 'bg-veil-faint'
                    } ${quality.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {quality.label}
                  </UiOptionButton>
                ))}
              </div>
            </div>
          )}

          {config.customInput && onWidthChange && onHeightChange && (
            <div>
              <label className={`mb-2 block ${UI_TEXT_LABEL_CLASS}`}>{t('resolutionPanel.customSizeLabel')}</label>
              <div className="flex gap-2 items-center">
                <div className="flex-1">
                  <UiInput
                    type="number"
                    value={customWidth}
                    onChange={(event) => onWidthChange(event.target.value)}
                    disabled={customInputDisabled}
                    placeholder="2048"
                    className="h-9"
                    min={512}
                    max={8192}
                  />
                </div>
                <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
                <div className="flex-1">
                  <UiInput
                    type="number"
                    value={customHeight}
                    onChange={(event) => onHeightChange(event.target.value)}
                    disabled={customInputDisabled}
                    placeholder="2048"
                    className="h-9"
                    min={512}
                    max={8192}
                  />
                </div>
                <span className="text-xs text-text-muted">PX</span>
              </div>
            </div>
          )}
        </div>
      )}
    />
  )
}

export default UniversalResolutionSelector
