import { UiOptionButton, UiSegmented } from '@/components/ui'

interface ParamChoice {
  label: string
  value: string | number
  disabled?: boolean
}

interface ParamChoiceGridProps {
  ariaLabel: string
  options: readonly ParamChoice[]
  value: string | number
  onChange: (value: string | number) => void
  disabled?: boolean
}

const SEGMENT_MAX = 5
const GRID_MAX = 12
/** 一排四格里放得下的标签长度（“自适应”“21:9”“1080p”） */
const GRID_LABEL_MAX = 6

/**
 * 摊开的单选：五项以内是分段（放不下时分段自己换成下拉），再多一些是四列小格。
 * 选项太多或标签太长时调用方继续用下拉。
 */
export function ParamChoiceGrid({ ariaLabel, options, value, onChange, disabled = false }: ParamChoiceGridProps): JSX.Element {
  if (options.length <= SEGMENT_MAX) {
    return (
      <UiSegmented
        ariaLabel={ariaLabel}
        options={options.map(option => ({ value: option.value, label: option.label, disabled: option.disabled }))}
        value={value}
        onChange={onChange}
        size="sm"
        fullWidth
        disabled={disabled}
      />
    )
  }
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="grid w-full grid-cols-4 gap-1">
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
          className="min-w-0 justify-center"
        >
          <span className="truncate">{option.label}</span>
        </UiOptionButton>
      ))}
    </div>
  )
}

ParamChoiceGrid.fits = (options: readonly ParamChoice[]): boolean => options.length > 0 && (
  options.length <= SEGMENT_MAX
  || (options.length <= GRID_MAX && options.every(option => [...option.label].length <= GRID_LABEL_MAX))
)
