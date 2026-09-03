import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'

import type { ScopedTextHistoryBinding } from './useScopedTextHistory'
import {
  UI_COLOR_ACCENT_FILL_TEXT_CLASS,
  UI_FIELD_CONTROL_HEIGHT_CLASS,
  UI_FIELD_CONTROL_HEIGHT_SM_CLASS,
  UI_FIELD_SURFACE_CLASS,
  UI_GLASS_ADAPTIVE_CONTROL_CLASS,
  UI_INSET_SURFACE_CLASS,
  UI_PANEL_SURFACE_CLASS,
} from './styleTokens'

export type ButtonVariant = 'primary' | 'muted' | 'ghost' | 'plain' | 'glass'

export type ButtonSize = 'sm' | 'md' | 'field' | 'field-sm'

export interface UiButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export interface UiIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
  showBorder?: boolean
  /**
   * `hover-only`：静息无框无底，悬浮时出现表面反馈。
   * `color-only`：始终无框无底，悬浮/按下时只压暗图标，适合数字步进箭头。
   * `glass`：压在图片/视频/画布上时用，材质与交互态全部来自 `.ui-glass`。
   */
  appearance?: 'default' | 'hover-only' | 'color-only' | 'glass'
  hoverVariant?: 'default' | 'danger'
}

export interface UiChipButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
  /** `navigation` 表示“正在看哪里”；默认 `toggle` 表示多选/标签开态。 */
  selectionRole?: 'toggle' | 'navigation'
  /** 仅收敛导航型 Tab 的视觉重量；其他选中语义不受影响。 */
  selectionAppearance?: 'default' | 'subtle'
}

export interface UiNavButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
}

export interface UiCheckboxProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean
  onCheckedChange?: (checked: boolean) => void
}

type UiSwitchBaseProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> & {
  checked: boolean
  onCheckedChange?: (checked: boolean) => void
}

export type UiSwitchProps = UiSwitchBaseProps & (
  | {
      appearance?: 'pill'
      offLabel?: never
      onLabel?: never
      size?: never
    }
  | {
      appearance: 'segmented'
      offLabel: ReactNode
      onLabel: ReactNode
      size?: 'field' | 'compact'
    }
)

export interface UiSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {}

export interface UiOptionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
  /**
   * `menu`：静息态完全透明，只靠 hover 与选中态表达状态。
   *
   * 用于同质选项的集合；孤立按钮不适用。
   */
  variant?: 'default' | 'card' | 'flat' | 'menu'
}

export interface UiInputProps extends InputHTMLAttributes<HTMLInputElement> {
  textHistory?: ScopedTextHistoryBinding
}

export interface UiTextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  textHistory?: ScopedTextHistoryBinding
}

export type UiPanelVariant = 'panel' | 'inset' | 'bare' | 'glass'

export interface UiPanelProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * `panel` 用于最外层独立表面；内部分组使用 `inset` 或 `bare`。
   * `glass` 只用于压在图片、视频或画布上的浮层。
   */
  variant?: UiPanelVariant
}

/** 轨道底色。`hue` 铺满色相光谱，供色相选择使用。 */
export type UiRangeTrackTone = 'neutral' | 'hue'

export interface UiRangeInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  trackTone?: UiRangeTrackTone
}

export function resolveTextHistoryValue(value: string | number | readonly string[] | undefined): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

export function resolveButtonVariant(variant: ButtonVariant): string {
  if (variant === 'primary') {
    return `border border-transparent ${UI_COLOR_ACCENT_FILL_TEXT_CLASS} text-white hover:brightness-110`
  }

  if (variant === 'glass') {
    return 'ui-glass ui-glass-interactive text-white'
  }

  if (variant === 'plain') {
    return 'border border-transparent text-text-muted hover:bg-layer hover:text-text-dark'
  }

  if (variant === 'ghost') {
    return `${UI_GLASS_ADAPTIVE_CONTROL_CLASS} border border-border-dark bg-surface-dark text-text-dark hover:bg-layer`
  }

  return `${UI_GLASS_ADAPTIVE_CONTROL_CLASS} ${UI_FIELD_SURFACE_CLASS} border border-border-dark text-text-dark hover:bg-layer`
}

export function resolveButtonSize(size: ButtonSize): string {
  if (size === 'sm') {
    return 'h-8 px-3 text-xs'
  }

  if (size === 'field') {
    return `${UI_FIELD_CONTROL_HEIGHT_CLASS} px-3.5 text-sm leading-none`
  }

  if (size === 'field-sm') {
    return `${UI_FIELD_CONTROL_HEIGHT_SM_CLASS} px-3.5 text-sm leading-none`
  }

  return 'h-10 px-3.5 text-sm'
}

export function resolveUiPanelSurface(variant: UiPanelVariant): string {
  if (variant === 'inset') {
    return `rounded-lg ${UI_INSET_SURFACE_CLASS}`
  }
  if (variant === 'bare') {
    return 'rounded-lg'
  }
  if (variant === 'glass') {
    return 'ui-glass ui-glass-elevated rounded-xl'
  }
  return `rounded-xl ${UI_PANEL_SURFACE_CLASS}`
}

// 两种轨道底色必须互斥，避免 Tailwind 产物顺序造成静默覆盖。
export const UI_RANGE_TRACK_TONE_CLASS: Record<UiRangeTrackTone, string> = {
  neutral: '[&::-webkit-slider-runnable-track]:bg-layer/80 [&::-moz-range-track]:bg-layer/80',
  hue: 'ui-range-track-hue',
}
