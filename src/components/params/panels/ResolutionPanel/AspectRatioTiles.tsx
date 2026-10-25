import React from 'react'
import { useTranslation } from 'react-i18next'
import { Zap } from 'lucide-react'
import { UI_ICON_SIZE_CLASS, UiOptionButton } from '@/components/ui'
import { groupAspectRatioOptions, type AspectRatioTileOption, type AspectTierOption, type RatioRow } from './aspectRatioGrouping'

export type { AspectRatioTileOption, AspectTierOption } from './aspectRatioGrouping'

/**
 * 比例与分辨率特殊面板的正文（重要记录 021）：生成页底栏与画布节点共用。
 *
 * 比例少（≤ 6 个）时排一行，保持模型声明的顺序；多时按形状分三行——智能与方形一行，横的一行、竖的一行，
 * 各自从接近方形排到最极端，找起来比 15 个格子混排快。分辨率有档位时竖排在右边一列，整块只占一层高。
 */
type AspectRatioTilesProps = {
  options: readonly AspectRatioTileOption[]
  isActive: (option: AspectRatioTileOption) => boolean
  onSelect: (option: AspectRatioTileOption) => void
  /** 分辨率档位；不传时不出右边那一列（画布节点里分辨率另占一行） */
  tiers?: readonly AspectTierOption[]
  isTierActive?: (option: AspectTierOption) => boolean
  onTierSelect?: (option: AspectTierOption) => void
}

const RATIO_ICON_MAX = { single: 20, rows: 18 } as const

function ratioIconSize(ratio: { width: number; height: number }, max: number): { width: number; height: number } {
  const scale = max / Math.max(ratio.width, ratio.height)
  return { width: Math.max(3, Math.round(ratio.width * scale)), height: Math.max(3, Math.round(ratio.height * scale)) }
}

export function AspectRatioTiles({ options, isActive, onSelect, tiers, isTierActive, onTierSelect }: AspectRatioTilesProps): JSX.Element {
  const { t } = useTranslation('ui')
  const rows = groupAspectRatioOptions(options)
  const singleRow = rows.length === 1
  const labelled = rows.length > 1 && rows.some(row => row.key !== 'lead')
  const iconMax = singleRow ? RATIO_ICON_MAX.single : RATIO_ICON_MAX.rows
  const rowLabel = (key: RatioRow['key']): string => key === 'landscape'
    ? t('resolutionPanel.landscape', { defaultValue: '横' })
    : key === 'portrait' ? t('resolutionPanel.portrait', { defaultValue: '竖' }) : ''

  return (
    <div data-aspect-ratio-tiles className="flex items-stretch gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-2xs text-text3">{t('resolutionPanel.aspectRatio', { defaultValue: '比例' })}</span>
        {rows.map(row => (
          <div key={row.key} className="flex items-center gap-1">
            {labelled ? <span className="w-6 shrink-0 text-2xs text-text3">{rowLabel(row.key)}</span> : null}
            {row.options.map(option => {
              const icon = option.ratio ? ratioIconSize(option.ratio, iconMax) : null
              return (
                <UiOptionButton
                  key={String(option.value)}
                  type="button"
                  variant="grid"
                  size="sm"
                  gridCell={singleRow ? 'ratio-md' : 'ratio-sm'}
                  active={isActive(option)}
                  onClick={() => onSelect(option)}
                  className="flex-col justify-center gap-1"
                >
                  <span className="flex h-5 items-center justify-center">
                    {option.smart ? <Zap className={UI_ICON_SIZE_CLASS.md} /> : icon ? (
                      <span className="rounded-sm border-2 border-current" style={{ width: icon.width, height: icon.height }} />
                    ) : null}
                  </span>
                  <span className="leading-none">{option.label}</span>
                </UiOptionButton>
              )
            })}
          </div>
        ))}
      </div>
      {tiers && tiers.length > 0 ? (
        <>
          <span className="w-px shrink-0 bg-line" aria-hidden />
          <div className="flex flex-col gap-1.5">
            <span className="text-2xs text-text3">{t('resolutionPanel.resolution', { defaultValue: '分辨率' })}</span>
            {tiers.map(option => (
              <UiOptionButton
                key={String(option.value)}
                type="button"
                variant="grid"
                size="sm"
                gridCell="tier-compact"
                active={isTierActive?.(option) ?? false}
                disabled={option.disabled}
                onClick={() => onTierSelect?.(option)}
                className="justify-center"
              >
                {option.label}
              </UiOptionButton>
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}
