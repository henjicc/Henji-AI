/**
 * 内置效果的参数写法，以及一个效果包含另一个效果。
 *
 * - 每个参数只写一份说明（`text`），悬停提示与助手读到的是同一句话。
 * - 包含：把另一个效果的参数整组放进当前效果，键加前缀、归入一个分组，名称与说明原样沿用；
 *   实现上当前效果在自己的某道中间结果上调用被包含效果的工序（例如发光只给光晕加色差）。
 *   所以“发光里的色差”只作用在光晕上，和在发光后面再加一个色差效果（作用在整个画面上）结果不同，两种都有用。
 */
import type { VideoEditBuiltinEffectDefinition, VideoEditBuiltinParam, VideoEditBuiltinParams } from './builtinEffects'

export interface EffectParamText { name: string; text: string; group?: string }
const said = ({ name, text, group }: EffectParamText): Pick<VideoEditBuiltinParam, 'name' | 'tooltip' | 'description' | 'group'> => ({ name, tooltip: text, description: text, ...(group ? { group } : {}) })

export const effectParam = {
  amount: (key: string, value: number, words: EffectParamText): VideoEditBuiltinParam => ({ key, type: 'number', unit: 'strength', min: 0, max: 100, step: 1, default: value, animatable: true, ...said(words) }),
  signed: (key: string, value: number, words: EffectParamText): VideoEditBuiltinParam => ({ key, type: 'number', unit: 'strength', min: -100, max: 100, step: 1, default: value, animatable: true, ...said(words) }),
  percent: (key: string, value: number, min: number, words: EffectParamText): VideoEditBuiltinParam => ({ key, type: 'number', unit: 'percent', min, max: 100, step: 1, default: value, animatable: true, ...said(words) }),
  angle: (key: string, value: number, words: EffectParamText): VideoEditBuiltinParam => ({ key, type: 'number', unit: 'degrees', min: -180, max: 180, step: 1, default: value, animatable: true, ...said(words) }),
  choice: (key: string, value: string, options: Array<{ value: string; label: string }>, words: EffectParamText): VideoEditBuiltinParam => ({ key, type: 'enum', default: value, options, ...said(words) }),
  color: (key: string, value: string, words: EffectParamText): VideoEditBuiltinParam => ({ key, type: 'color', default: value, animatable: true, ...said(words) }),
  toggle: (key: string, value: boolean, words: EffectParamText): VideoEditBuiltinParam => ({ key, type: 'boolean', default: value, ...said(words) }),
}

/** 把 `definition` 的参数放进分组 `group`，键改为 `<prefix>_<原键>`；`defaults` 按原键覆盖默认值。 */
export function includedEffectParams(definition: VideoEditBuiltinEffectDefinition, prefix: string, group: string, defaults: Readonly<Record<string, VideoEditBuiltinParams[string]>> = {}): VideoEditBuiltinParam[] {
  return definition.params.map(param => ({
    ...param, key: `${prefix}_${param.key}`, group,
    ...(param.key in defaults ? { default: defaults[param.key] } : {}),
    ...(param.visibleWhen ? { visibleWhen: { ...param.visibleWhen, param: `${prefix}_${param.visibleWhen.param}` } } : {}),
  }) as VideoEditBuiltinParam)
}

/** 从当前效果的参数里取回被包含效果自己的参数（去掉前缀）。 */
export function includedEffectValues(params: VideoEditBuiltinParams, prefix: string): VideoEditBuiltinParams {
  const head = `${prefix}_`
  return Object.fromEntries(Object.entries(params).filter(([key]) => key.startsWith(head)).map(([key, value]) => [key.slice(head.length), value]))
}
