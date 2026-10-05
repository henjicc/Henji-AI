import { UI_SEGMENTED_TRACK_CLASS, UiOptionButton } from '@/components/ui'

interface SettingsSegmentedProps<T extends string> {
  value: T
  options: ReadonlyArray<{ value: T; label: string }>
  onChange: (value: T) => void
  ariaLabel: string
  disabled?: boolean
}

/**
 * 设置里的单选分段控件。
 *
 * 统一写法：选项不超过 4 个、文字又短的单选一律用它，其余用下拉。
 * 以前「层级对比」（三选一）是分段、紧挨着的「圆角尺寸」（也是三选一）却是下拉，同一页两种写法。
 */
export default function SettingsSegmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  disabled,
}: SettingsSegmentedProps<T>): JSX.Element {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={UI_SEGMENTED_TRACK_CLASS}>
      {options.map((option) => (
        <UiOptionButton
          key={option.value}
          type="button"
          variant="segment"
          role="radio"
          aria-checked={value === option.value}
          active={value === option.value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </UiOptionButton>
      ))}
    </div>
  )
}
