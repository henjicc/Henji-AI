import { useRef, type CSSProperties, type ReactNode } from 'react'
import { UiRangeInput } from '@/components/ui/primitives'
import {
  UI_LIGHTING_BRIGHTNESS_GRADIENT,
  UI_LIGHTING_COLOR_GRADIENT,
  UI_LIGHTING_COLORS,
  UI_TEXT_META_CLASS,
} from '@/components/ui/styleTokens'
import {
  RELIGHT_BRIGHTNESS_LEVELS,
  type RelightBrightness,
  type RelightColorPreset,
  type RelightSettingsV1,
} from '@/features/canvas/capabilities/relightPolicy'

const COLOR_ORDER = ['amber', 'warm', 'neutral', 'cool', 'cyan', 'blue', 'magenta', 'red'] as const
const COLOR_LABELS: Record<RelightColorPreset, string> = {
  neutral: '中性白', warm: '暖白', cool: '冷白', amber: '琥珀',
  red: '红色', blue: '蓝色', cyan: '青色', magenta: '品红',
}
const BRIGHTNESS_LABELS: Record<RelightBrightness, string> = {
  [-2]: '很暗', [-1]: '偏暗', 0: '自然', 1: '偏亮', 2: '高调',
}
export type RelightLightingDraft = Pick<RelightSettingsV1['manual'], 'brightness' | 'colorPreset'>

interface Props {
  value: RelightLightingDraft
  brightnessTitle: ReactNode
  colorTitle: ReactNode
  onPreview: (value: RelightLightingDraft | null) => void
  onCommit: (value: RelightLightingDraft) => void
}

/** 复用原生 range 的键盘、触摸与吸附行为；拖动只更新工作台预览，松手才持久化。 */
export function RelightLightingControls({ value, brightnessTitle, colorTitle, onPreview, onCommit }: Props): JSX.Element {
  const activePointer = useRef<number | null>(null)
  const pending = useRef<RelightLightingDraft | null>(null)
  const finish = (): void => {
    const next = pending.current
    pending.current = null
    activePointer.current = null
    if (next) onCommit(next)
    onPreview(null)
  }
  const cancel = (): void => {
    pending.current = null
    activePointer.current = null
    onPreview(null)
  }
  const controls = [
    {
      name: '亮度', title: brightnessTitle, index: RELIGHT_BRIGHTNESS_LEVELS.indexOf(value.brightness),
      labels: RELIGHT_BRIGHTNESS_LEVELS.map((level) => BRIGHTNESS_LABELS[level]),
      colors: RELIGHT_BRIGHTNESS_LEVELS.map(() => UI_LIGHTING_COLORS.neutral),
      gradient: UI_LIGHTING_BRIGHTNESS_GRADIENT,
      next: (index: number): RelightLightingDraft => ({ ...value, brightness: RELIGHT_BRIGHTNESS_LEVELS[index] }),
    },
    {
      name: '色调', title: colorTitle, index: COLOR_ORDER.indexOf(value.colorPreset),
      labels: COLOR_ORDER.map((color) => COLOR_LABELS[color]),
      colors: COLOR_ORDER.map((color) => UI_LIGHTING_COLORS[color]),
      gradient: UI_LIGHTING_COLOR_GRADIENT,
      next: (index: number): RelightLightingDraft => ({ ...value, colorPreset: COLOR_ORDER[index] }),
    },
  ]
  return <>
    {controls.map((control) => (
      <div key={control.name} className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          {control.title}
          <span className="text-xs text-text-soft" aria-hidden="true">{control.labels[control.index]}</span>
        </div>
        <UiRangeInput
          aria-label={control.name}
          aria-valuetext={control.labels[control.index]}
          min={0} max={control.labels.length - 1} step={1} value={control.index}
          trackTone="lighting"
          className="nodrag nowheel touch-none"
          style={{ '--lighting-track': control.gradient, '--lighting-color': control.colors[control.index] } as CSSProperties}
          onPointerDown={(event) => {
            if (event.button !== 0) return
            activePointer.current = event.pointerId
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onChange={(event) => {
            const next = control.next(Number(event.target.value))
            if (activePointer.current === null) onCommit(next)
            else {
              pending.current = next
              onPreview(next)
            }
          }}
          onPointerUp={finish}
          onPointerCancel={cancel}
          onLostPointerCapture={() => { if (activePointer.current !== null) cancel() }}
          onBlur={finish}
        />
        <div aria-hidden="true" className={`pointer-events-none flex justify-between px-3.5 ${UI_TEXT_META_CLASS}`}>
          {control.labels.map((label, index) => (
            <span key={label} className="flex w-0 justify-center">
              <span className={`h-1 w-1 shrink-0 rounded-full ${index === control.index ? 'opacity-100' : 'opacity-30'}`}
                style={{ backgroundColor: control.colors[index] }} />
            </span>
          ))}
        </div>
      </div>
    ))}
  </>
}
