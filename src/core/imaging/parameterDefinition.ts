export type ImagingParamValue = number | boolean | string
export type ImagingParams = Record<string, ImagingParamValue>
/** 数值单位：strength 为 0–100 的无量纲强度，percent 为百分比，degrees 为角度，stops 为曝光档；音频效果另有 dB、Hz 与半音；value 为组件自带量纲的普通数值（着色器组件）。 */
export type ImagingUnit = 'strength' | 'percent' | 'degrees' | 'stops' | 'decibels' | 'hertz' | 'semitones' | 'multiplier' | 'value' | 'fraction_height'
interface ParamBase { key: string; name: string; tooltip: string; description: string; animatable?: boolean }
export type ImagingParam =
  | ParamBase & { type: 'number'; unit: ImagingUnit; min: number; max: number; step: number; default: number }
  /** `alpha` 时可写 #rrggbbaa（着色器组件的半透明颜色）。 */
  | ParamBase & { type: 'color'; default: string; alpha?: boolean }
  | ParamBase & { type: 'enum'; options: ReadonlyArray<{ value: string; label: string }>; default: string }
  | ParamBase & { type: 'boolean'; default: boolean }
  | ParamBase & { type: 'curve' | 'lut'; default: string }

export const IMAGING_UNIT_LABELS: Record<ImagingUnit, string> = { strength: "", percent: "%", degrees: "°", stops: "档", decibels: "dB", hertz: "Hz", semitones: "半音", multiplier: "倍", value: "", fraction_height: '画面高度' }
