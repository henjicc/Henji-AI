import { UI_TEXT_META_CLASS, UiRangeInput, UiReadout } from '@/components/ui'
import NumberField from '@/components/ui/NumberInput'
import { UiFormRowLabelContext } from '@/components/ui/formRowLabel'

interface ParamSliderProps {
  ariaLabel: string
  min: number
  max: number
  step: number
  value: number
  onChange: (value: number) => void
  /**
   * 右侧读数。`number`：可编辑的数值框（点一下直接输入精确值，也能左右拖），单位跟在后面；
   * `label`：只读的档位名。
   */
  readout: { kind: 'number'; unit?: string; precision?: number } | { kind: 'label'; text: string }
  disabled?: boolean
}

/** 摊开排布里的滑块：轨道占满控件列，读数跟在右边。数值与档位共用。 */
export function ParamSlider({ ariaLabel, min, max, step, value, onChange, readout, disabled = false }: ParamSliderProps): JSX.Element {
  return (
    <div className="flex w-full items-center gap-2">
      <UiRangeInput
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-valuetext={readout.kind === 'label' ? readout.text : undefined}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {/* 读数占同一宽度的槽位并靠右，上下几行滑块的轨道终点对齐 */}
      {readout.kind === 'label' ? <span className="flex w-20 shrink-0 justify-end"><UiReadout size="sm">{readout.text}</UiReadout></span> : (
        <span className="flex w-20 shrink-0 items-center justify-end gap-1">
          {/* 读数是独立的小数值框，不随表单行撑满控件列 */}
          <UiFormRowLabelContext.Provider value={null}>
            <NumberField
              value={value}
              onChange={onChange}
              min={min}
              max={max}
              step={step}
              precision={readout.precision}
              size="sm"
              align="center"
              widthStrategy="content"
              disabled={disabled}
              ariaLabel={ariaLabel}
            />
          </UiFormRowLabelContext.Provider>
          {readout.unit ? <span className={UI_TEXT_META_CLASS}>{readout.unit}</span> : null}
        </span>
      )}
    </div>
  )
}

/**
 * 有先后顺序的档位（质量、推理强度这类）：选项值全部来自同一套档位词时按 schema 里的顺序排成滑块，
 * “自动”这类不定档排在最右一格（在所有确定档位之后）。只认值、不认模型，新模型沿用同样的取值就自动生效。
 */
const ORDERED_LEVEL_VALUES = new Set(['auto', 'off', 'none', 'minimal', 'low', 'medium', 'regular', 'standard', 'high', 'xhigh', 'ultra', 'max', 'maximum'])
const ORDERED_LEVEL_MIN_OPTIONS = 3

export function isOrderedLevelChoice(options: readonly { value: string | number }[]): boolean {
  return options.length >= ORDERED_LEVEL_MIN_OPTIONS
    && options.every(option => typeof option.value === 'string' && ORDERED_LEVEL_VALUES.has(option.value.toLowerCase()))
}

/** “自动”不是一个确定档位：滑块上排在所有确定档位之后 */
export function orderLevelChoices<T extends { value: string | number }>(options: readonly T[]): T[] {
  const isAuto = (option: T): boolean => String(option.value).toLowerCase() === 'auto'
  return [...options.filter(option => !isAuto(option)), ...options.filter(isAuto)]
}
