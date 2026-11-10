import React from 'react'
import { Zap } from 'lucide-react'
import { UI_ICON_SIZE_CLASS, UiOptionButton } from '@/components/ui'
import { pairAspectRatioColumns, type AspectRatioTileOption, type AspectTierOption } from './aspectRatioGrouping'

export type { AspectRatioTileOption, AspectTierOption } from './aspectRatioGrouping'

/**
 * 比例与分辨率特殊面板的正文：生成页底栏与画布节点共用。
 *
 * 比例横竖成对排成两行：每一列是一对互为转置的比例，上横下竖，第一列是智能与方形，所以不用写“横”“竖”。
 * 没有任何一列凑成两格时（例如只有几个横比例）收成一行，不留空行。分辨率有档位时在下面等分一行，
 * 宽度与比例网格对齐；格子与分辨率的形状已经说明各自是什么，面板里不放标题。
 */
type AspectRatioTilesProps = {
  options: readonly AspectRatioTileOption[]
  isActive: (option: AspectRatioTileOption) => boolean
  onSelect: (option: AspectRatioTileOption) => void
  /** 分辨率档位；不传时不出下面那一行（画布节点里分辨率另占一行） */
  tiers?: readonly AspectTierOption[]
  isTierActive?: (option: AspectTierOption) => boolean
  onTierSelect?: (option: AspectTierOption) => void
}

const RATIO_ICON_MAX = 20

/** 比例示意：按比例缩放的描边矩形，智能是闪电。比例格与左侧输入面板的比例小格共用。 */
export function AspectRatioGlyph({ option, max = RATIO_ICON_MAX }: { option: AspectRatioTileOption; max?: number }): JSX.Element | null {
  if (option.smart) return <Zap className={UI_ICON_SIZE_CLASS.md} />
  if (!option.ratio) return null
  const scale = max / Math.max(option.ratio.width, option.ratio.height)
  const width = Math.max(3, Math.round(option.ratio.width * scale))
  const height = Math.max(3, Math.round(option.ratio.height * scale))
  return <span className="rounded-sm border-2 border-current" style={{ width, height }} />
}

export function AspectRatioTiles({ options, isActive, onSelect, tiers, isTierActive, onTierSelect }: AspectRatioTilesProps): JSX.Element {
  const columns = pairAspectRatioColumns(options)
  const twoRows = columns.some(column => column.top && column.bottom)

  const tile = (option: AspectRatioTileOption): JSX.Element => {
    return (
      <UiOptionButton
        key={String(option.value)}
        type="button"
        variant="grid"
        size="sm"
        gridCell="ratio-md"
        active={isActive(option)}
        onClick={() => onSelect(option)}
        className="flex-col justify-center gap-1.5"
      >
        <span className="flex h-5 items-center justify-center"><AspectRatioGlyph option={option} /></span>
        <span className="leading-none">{option.label}</span>
      </UiOptionButton>
    )
  }

  return (
    <div data-aspect-ratio-tiles className="inline-flex flex-col gap-2">
      {twoRows ? (
        <div className="grid grid-flow-col grid-rows-2 gap-1.5">
          {columns.flatMap(column => [
            column.top ? tile(column.top) : <span key={`${column.key}-top`} aria-hidden />,
            column.bottom ? tile(column.bottom) : <span key={`${column.key}-bottom`} aria-hidden />,
          ])}
        </div>
      ) : (
        <div className="flex gap-1.5">
          {columns.map(column => tile((column.top ?? column.bottom) as AspectRatioTileOption))}
        </div>
      )}
      {tiers && tiers.length > 0 ? (
        <div className="flex gap-1.5">
          {tiers.map(option => (
            <UiOptionButton
              key={String(option.value)}
              type="button"
              variant="grid"
              size="sm"
              active={isTierActive?.(option) ?? false}
              disabled={option.disabled}
              onClick={() => onTierSelect?.(option)}
              className="min-w-0 flex-1 justify-center"
            >
              {option.label}
            </UiOptionButton>
          ))}
        </div>
      ) : null}
    </div>
  )
}
