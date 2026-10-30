import type { CodeParameterVisibility } from './parameterTypes'

export type ImagingParamValue = number | boolean | string
export type ImagingParams = Record<string, ImagingParamValue>
/** 数值单位：strength 为 0–100 的无量纲强度，percent 为百分比，degrees 为角度，stops 为曝光档，kelvin 为色温开尔文；音频效果另有 dB、Hz、半音与毫秒；value 为组件自带量纲的普通数值（着色器组件）。 */
export type ImagingUnit = 'strength' | 'percent' | 'degrees' | 'stops' | 'decibels' | 'hertz' | 'semitones' | 'milliseconds' | 'multiplier' | 'value' | 'fraction_height' | 'kelvin'
/**
 * `group`：参数所在的分组（如“着色”），效果控件按组折叠显示，助手读到的参数说明也带上组名；
 * 不写的是主参数，排在最上面。分组只管摆放，人和助手能调的参数完全相同。
 * `visibleWhen`：只在另一个参数取某些值时才有用，其余时候效果控件里隐藏；与作者参数用同一种条件写法。
 */
interface ParamBase { key: string; name: string; tooltip: string; description: string; animatable?: boolean; group?: string; visibleWhen?: CodeParameterVisibility }
export type ImagingParam =
  | ParamBase & { type: 'number'; unit: ImagingUnit; min: number; max: number; step: number; default: number }
  /** `alpha` 时可写 #rrggbbaa（着色器组件的半透明颜色）。 */
  | ParamBase & { type: 'color'; default: string; alpha?: boolean }
  | ParamBase & { type: 'enum'; options: ReadonlyArray<{ value: string; label: string }>; default: string }
  | ParamBase & { type: 'boolean'; default: boolean }
  | ParamBase & { type: 'curve' | 'lut'; default: string }

export const IMAGING_UNIT_LABELS: Record<ImagingUnit, string> = { strength: "", percent: "%", degrees: "°", stops: "档", decibels: "dB", hertz: "Hz", semitones: "半音", milliseconds: "ms", multiplier: "倍", value: "", fraction_height: '画面高度', kelvin: 'K' }
