import type { UiControlSize } from './primitiveInternals'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ownerWindowOf } from '@/utils/crossRealmDom'
import { UiOptionButton } from './primitives'
import { UI_CONTROL_HEIGHT_CLASS } from './styleTokens'
import { useUiFormRowLabelling } from './formRowLabel'
import Dropdown from './Dropdown'
import { measureParentSlack } from './measureParentSlack'

export interface UiSegmentedOption<T extends string | number> {
  value: T
  label: string
  icon?: ReactNode
  disabled?: boolean
  disabledReason?: string
  title?: string
  ariaLabel?: string
}

export interface UiSegmentedProps<T extends string | number> {
  ariaLabel: string
  options: readonly UiSegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  size?: UiControlSize
  fullWidth?: boolean
  disabled?: boolean
  disabledReason?: string
  /** 悬停/聚焦候选项时预览，离开时清除；不改变当前选择。 */
  onPreview?: (value: T | undefined) => void
}

/**
 * 同一取值的等宽分段；单一 Tab 停靠点，方向键循环选择并跳过禁用项。
 * 放不下时（窄面板，如 3D 属性栏的“体型”四段在 960 宽下每段只剩 22px、文字叠成一串）改用同一组选项的下拉，
 * 宽度恢复到能放下全部分段时换回分段（重要记录 020）。此前只在开发态打警告，正式版照样叠字。
 */
export function UiSegmented<T extends string | number>({ ariaLabel, options, value, onChange, size = 'md', fullWidth = false, disabled = false, disabledReason, onPreview }: UiSegmentedProps<T>): JSX.Element {
  const buttons = useRef(new Map<T, HTMLButtonElement>())
  const formRow = useUiFormRowLabelling()
  const fillControl = fullWidth || formRow?.fillControl === true
  const enabled = options.filter(option => !option.disabled)
  const tabValue = enabled.some(option => option.value === value) ? value : enabled[0]?.value
  const useDropdown = options.length > 5 || options.some(option => !/^\d{1,3}\s*[\p{Script=Han}]{1,4}$/u.test(option.label) && [...option.label].length > (/\p{Script=Han}/u.test(option.label) ? 4 : 12))
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const [narrow, setNarrow] = useState(false)
  // 收成下拉前分段需要的宽度：等宽分段 = 最宽一段 × 段数 + 段间距 + 外框内边距
  const naturalWidth = useRef(0)
  // 调用方每次渲染都会新建 options 数组：只随选项文字变化重测，尺寸变化交给 ResizeObserver
  const optionsKey = options.map(option => option.label).join('|')
  useLayoutEffect(() => {
    const wrapper = wrapperRef.current
    if (useDropdown || !wrapper) return
    const view = ownerWindowOf(wrapper)
    const check = (): void => {
      const available = wrapper.clientWidth + measureParentSlack(wrapper)
      if (narrow) {
        if (naturalWidth.current > 0 && available >= naturalWidth.current) setNarrow(false)
        return
      }
      const group = wrapper.firstElementChild
      const optionButtons = [...buttons.current.values()]
      if (!group || optionButtons.length === 0) return
      const groupWidth = group.getBoundingClientRect().width
      const spill = optionButtons.some((button) => button.scrollWidth > button.clientWidth + 1) || groupWidth > wrapper.clientWidth + 1
      if (!spill) return
      const groupStyle = view.getComputedStyle(group)
      const gap = Number.parseFloat(groupStyle.columnGap) || 0
      const padding = (Number.parseFloat(groupStyle.paddingLeft) || 0) + (Number.parseFloat(groupStyle.paddingRight) || 0)
      const widest = Math.max(...optionButtons.map((button) => button.scrollWidth))
      // 此刻已经放不下：换回分段至少要比现在宽，估算偏小也不会在分段与下拉之间来回切
      naturalWidth.current = Math.ceil(Math.max(groupWidth, widest * optionButtons.length + gap * (optionButtons.length - 1) + padding, available + 1))
      setNarrow(true)
    }
    check()
    const ResizeObserverCtor = view.ResizeObserver
    if (!ResizeObserverCtor) return
    const observer = new ResizeObserverCtor(check)
    observer.observe(wrapper)
    if (wrapper.parentElement) observer.observe(wrapper.parentElement)
    buttons.current.forEach((button) => observer.observe(button))
    return () => observer.disconnect()
  }, [narrow, optionsKey, useDropdown])
  // 放不下换成的下拉不按选项定最小宽：否则它会撑出外层格子、压到旁边的按钮上
  const dropdown = <Dropdown ariaLabel={ariaLabel} options={options.map(option => ({ ...option, tooltip: option.disabledReason ?? option.title }))} value={value} onSelect={onChange} onPreview={onPreview} size={size} className={fillControl ? 'w-full' : undefined} disabled={disabled} disabledReason={disabledReason} minWidthStrategy={useDropdown ? undefined : 'none'} />
  if (useDropdown) return dropdown
  // 外层只用来测“给了多宽”：可收窄（min-w-0），不比父级宽，行内排布与原分段一致
  return <div ref={wrapperRef} data-ui-segmented-fit className={`inline-flex min-w-0 max-w-full ${fillControl ? 'w-full' : ''}`}>{narrow ? dropdown : <div role="radiogroup" aria-label={ariaLabel} aria-disabled={disabled || undefined}
    className={`inline-grid auto-cols-fr grid-flow-col gap-0.5 rounded-lg bg-gap p-0.5 ${UI_CONTROL_HEIGHT_CLASS[size]} ${fillControl ? 'w-full' : 'w-fit'}`}>
    {/* ui-surface-allow: S1 u5 统一分段组件内部使用原语渲染选项，调用方必须用 UiSegmented。 */}
    {options.map(option => <UiOptionButton key={option.value} type="button" variant="segment" size={size}
      ref={button => { if (button) buttons.current.set(option.value, button); else buttons.current.delete(option.value) }}
      role="radio" aria-checked={value === option.value} tabIndex={!disabled && option.value === tabValue ? 0 : -1}
      active={value === option.value} disabled={disabled || option.disabled} disabledReason={disabled ? disabledReason : option.disabledReason} tooltip={option.title} aria-label={option.ariaLabel}
      onMouseEnter={() => { if (!disabled && !option.disabled) onPreview?.(option.value) }} onMouseLeave={() => onPreview?.(undefined)}
      onFocus={() => { if (!disabled && !option.disabled) onPreview?.(option.value) }} onBlur={() => onPreview?.(undefined)}
      onClick={() => onChange(option.value)} onKeyDown={event => {
        if (disabled || option.disabled || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const current = enabled.findIndex(item => item.value === option.value)
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length
        const next = enabled[index]
        if (next) { buttons.current.get(next.value)?.focus(); onChange(next.value) }
      }}>{option.icon}{option.label}</UiOptionButton>)}
  </div>}</div>
}
