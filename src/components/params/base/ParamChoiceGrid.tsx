import type { ReactNode } from 'react'
import { UiOptionButton, UiSegmented } from '@/components/ui'

interface ParamChoice {
  label: string
  value: string | number
  disabled?: boolean
  /** 小图示（比例矩形等），排在文字前面 */
  icon?: ReactNode
}

interface ParamChoiceGridProps {
  ariaLabel: string
  options: readonly ParamChoice[]
  value: string | number
  onChange: (value: string | number) => void
  disabled?: boolean
  /** `inline`：图示在文字前；`stacked`：图示在上、文字在下（比例格，竖向空间充足时用） */
  cellLayout?: 'inline' | 'stacked'
}

const SEGMENT_MAX = 5
const GRID_MAX = 12
/** 小格里放得下的标签长度（“自适应”“21:9”“1080p”） */
const GRID_LABEL_MAX = 6

/**
 * 摊开的单选：五项以内是分段（放不下时分段自己换成下拉），再多一些是小格，列数随面板宽度自动排。
 * 选项太多或标签太长时调用方继续用下拉。
 */
export function ParamChoiceGrid({ ariaLabel, options, value, onChange, disabled = false, cellLayout = 'inline' }: ParamChoiceGridProps): JSX.Element {
  const stacked = cellLayout === 'stacked'
  if (options.length <= SEGMENT_MAX && !stacked) {
    return (
      <UiSegmented
        ariaLabel={ariaLabel}
        options={options.map(option => ({ value: option.value, label: option.label, disabled: option.disabled, icon: option.icon }))}
        value={value}
        onChange={onChange}
        size="sm"
        fullWidth
        disabled={disabled}
      />
    )
  }
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={`grid w-full gap-1 ${stacked ? 'grid-cols-[repeat(auto-fill,minmax(3.5rem,1fr))]' : 'grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))]'}`}>
      {options.map(option => (
        <UiOptionButton
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          variant="grid"
          size="sm"
          active={option.value === value}
          disabled={disabled || option.disabled}
          onClick={() => onChange(option.value)}
          className={stacked ? 'min-w-0 flex-col justify-center gap-1.5 py-2' : 'min-w-0 justify-center gap-1.5'}
        >
          {option.icon ? <span aria-hidden="true" className={`flex shrink-0 items-center justify-center ${stacked ? 'h-5' : 'h-3.5 w-3.5'}`}>{option.icon}</span> : null}
          <span className="max-w-full truncate leading-none">{option.label}</span>
        </UiOptionButton>
      ))}
    </div>
  )
}

ParamChoiceGrid.fits = (options: readonly ParamChoice[]): boolean => options.length > 0 && (
  options.length <= SEGMENT_MAX
  || (options.length <= GRID_MAX && options.every(option => [...option.label].length <= GRID_LABEL_MAX))
)
