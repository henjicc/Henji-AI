import React from 'react'
import NumberInput from '@/components/ui/NumberInput'
import { UiColorInput, UiFormRow, UiRangeInput, UiSwitch } from '@/components/ui'
import type { StageVec3 } from '../domain/sceneTypes'

/**
 * 3D 镜头参考停靠面板（对象、属性、相机、姿势、场景设置）的行写法，界面重设计 5.5。
 * 窄停靠面板统一用 `UiFormRow density="compact"`（配 `UiGroup titleTone="compact"`），字段一律 sm 档，
 * 与剪辑效果控件同一套排布；这里只是把同一种行组合收在一处，不重写任何控件外观。
 */

const AXES: Array<keyof StageVec3> = ['x', 'y', 'z']
const AXIS_LABELS: Record<keyof StageVec3, string> = { x: 'X', y: 'Y', z: 'Z' }

interface SliderNumberRowProps {
  label: React.ReactNode
  ariaLabel: string
  value: number
  min: number
  max: number
  step: number
  precision: number
  onChange: (next: number) => void
  info?: React.ReactNode
  /** 只读读数（如时间 08:30）代替数值框 */
  readout?: React.ReactNode
}

/** 滑杆 + 数值框：标签在上，滑杆铺满，右侧数值框可拖动改值。 */
export const SliderNumberRow: React.FC<SliderNumberRowProps> = ({
  label,
  ariaLabel,
  value,
  min,
  max,
  step,
  precision,
  onChange,
  info,
  readout,
}) => (
  <UiFormRow label={label} info={info} density="compact">
    <div className="flex items-center gap-2">
      <UiRangeInput
        aria-label={ariaLabel}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {readout ?? (
        <NumberInput
          ariaLabel={ariaLabel}
          size="sm"
          value={value}
          min={min}
          max={max}
          step={step}
          precision={precision}
          widthClassName="w-16"
          align="right"
          className="shrink-0"
          commitOnChange
          wheelStep
          onChange={onChange}
        />
      )}
    </div>
  </UiFormRow>
)

/** 颜色行：标签左、取色器右。 */
export const ColorRow: React.FC<{ label: string; value: string; onChange: (next: string) => void }> = ({
  label,
  value,
  onChange,
}) => (
  <UiFormRow label={label} density="compact" inline>
    <UiColorInput aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} />
  </UiFormRow>
)

/** 开关行：标签左、开关右。 */
export const SwitchRow: React.FC<{ label: string; checked: boolean; onChange: (next: boolean) => void }> = ({
  label,
  checked,
  onChange,
}) => (
  <UiFormRow label={label} density="compact" inline>
    <UiSwitch aria-label={label} checked={checked} onCheckedChange={onChange} />
  </UiFormRow>
)

interface Vec3RowProps {
  label: React.ReactNode
  /** 读屏与拖动标签用的名称，如“位置” */
  name: string
  value: StageVec3
  step: number
  precision: number
  min?: number
  max?: number
  axes?: Array<keyof StageVec3>
  /** 标签行右侧的附加控件（如等比缩放锁） */
  actions?: React.ReactNode
  onAxisChange: (axis: keyof StageVec3, next: number) => void
}

/** 三轴数值行：一行标签，下方 X / Y / Z 三个等宽数值框，轴名写在框上方。 */
export const Vec3Row: React.FC<Vec3RowProps> = ({
  label,
  name,
  value,
  step,
  precision,
  min,
  max,
  axes = AXES,
  actions,
  onAxisChange,
}) => (
  <UiFormRow
    density="compact"
    label={actions ? (
      <span className="flex items-center justify-between gap-2">
        <span>{label}</span>
        {actions}
      </span>
    ) : label}
  >
    <div className="flex gap-1.5">
      {axes.map((axis) => (
        <div key={axis} className="min-w-0 flex-1">
          <div aria-hidden="true" className="mb-0.5 text-2xs text-text3">{AXIS_LABELS[axis]}</div>
          <NumberInput
            ariaLabel={`${name} ${AXIS_LABELS[axis]}`}
            size="sm"
            value={value[axis]}
            step={step}
            precision={precision}
            min={min}
            max={max}
            widthClassName="w-full"
            className="min-w-0"
            commitOnChange
            wheelStep
            onChange={(next) => onAxisChange(axis, next)}
          />
        </div>
      ))}
    </div>
  </UiFormRow>
)
