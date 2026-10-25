/**
 * AspectRatioSelector - 组合面板里的比例子组件（componentRegistry 的 `aspect-ratio`）。
 * 外观与排布全部委托 AspectRatioTiles，与生成页、画布节点的比例面板是同一份实现。
 */

import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { formatAspectRatioDisplayLabel } from '@/core/params/ratioResolution'
import { getI18nText } from '@/core/types'
import { parseRatio } from '@/components/MediaGenerator/components/aspectResolutionPanelUtils'
import { AspectRatioTiles, type AspectRatioTileOption } from './AspectRatioTiles'
import type { AspectRatioOption } from './types'

export interface AspectRatioSelectorProps {
  value: string
  onChange: (value: string) => void
  options: AspectRatioOption[]
  smartMatchEnabled?: boolean
}

export const AspectRatioSelector: React.FC<AspectRatioSelectorProps> = ({
  value,
  onChange,
  options,
  smartMatchEnabled = false
}) => {
  const { t, i18n } = useTranslation('ui')
  const tileOptions = useMemo<AspectRatioTileOption[]>(() => {
    const ratios = options
      .filter(option => !(smartMatchEnabled && option.value === 'smart'))
      .map(option => {
        const label = formatAspectRatioDisplayLabel(String(getI18nText(option.label, i18n.language) || option.value), option.value)
        return { value: option.value, label, ratio: option.icon ?? parseRatio(option.value) ?? parseRatio(label) }
      })
    return smartMatchEnabled
      ? [{ value: 'smart', label: t('resolutionPanel.smart', { defaultValue: '智能' }), ratio: null, smart: true }, ...ratios]
      : ratios
  }, [i18n.language, options, smartMatchEnabled, t])

  return (
    <AspectRatioTiles
      options={tileOptions}
      isActive={option => String(option.value) === value}
      onSelect={option => onChange(String(option.value))}
    />
  )
}
