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
const said = ({ name, text, group }: EffectParamText): Pick<VideoEditBuiltinParam, 'name' | 'description' | 'group'> => ({ name, description: text, ...(group ? { group } : {}) })
/** 硬范围比滑块宽时，滑块仍走 0–100（或 −100–100），点数字可输入到硬范围。 */
const soft = (hard: number | undefined, softMin: number, softMax: number): { min: number; max: number; softMin?: number; softMax?: number } =>
  hard === undefined ? { min: softMin, max: softMax } : { min: softMin < 0 ? -hard : 0, max: hard, softMin, softMax }

export const effectParam = {
  /** `hardMax`：可以输入的上限（超出滑块的 100 仍有意义时写）。 */
  amount: (key: string, value: number, words: EffectParamText, hardMax?: number): VideoEditBuiltinParam => ({ key, type: 'number', unit: 'strength', ...soft(hardMax, 0, 100), step: 1, default: value, animatable: true, ...said(words) }),
  signed: (key: string, value: number, words: EffectParamText, hardLimit?: number): VideoEditBuiltinParam => ({ key, type: 'number', unit: 'strength', ...soft(hardLimit, -100, 100), step: 1, default: value, animatable: true, ...said(words) }),
  percent: (key: string, value: number, min: number, words: EffectParamText): VideoEditBuiltinParam => ({ key, type: 'number', unit: 'percent', min, max: 100, step: 1, default: value, animatable: true, ...said(words) }),
  angle: (key: string, value: number, words: EffectParamText): VideoEditBuiltinParam => ({ key, type: 'number', unit: 'degrees', min: -180, max: 180, step: 1, default: value, animatable: true, ...said(words) }),
  choice: (key: string, value: string, options: Array<{ value: string; label: string }>, words: EffectParamText): VideoEditBuiltinParam => ({ key, type: 'enum', default: value, options, ...said(words) }),
  color: (key: string, value: string, words: EffectParamText): VideoEditBuiltinParam => ({ key, type: 'color', default: value, animatable: true, ...said(words) }),
  toggle: (key: string, value: boolean, words: EffectParamText): VideoEditBuiltinParam => ({ key, type: 'boolean', default: value, ...said(words) }),
}

/** 被包含参数的改动：改默认值时必须同时给新说明，说明里写着“（默认）”的取值才不会与实际不符。 */
export interface IncludedParamOverride { default: VideoEditBuiltinParams[string]; text: string }
/**
 * 把 `definition` 的参数放进分组 `group`，键改为 `<prefix>_<原键>`。
 * `keys` 只取其中几项（其余由当前效果在规划里固定）；`overrides` 按原键改默认值与说明。
 */
export function includedEffectParams(definition: VideoEditBuiltinEffectDefinition, prefix: string, group: string, options: { keys?: readonly string[]; overrides?: Readonly<Record<string, IncludedParamOverride>> } = {}): VideoEditBuiltinParam[] {
  const overrides = options.overrides ?? {}
  for (const key of Object.keys(overrides)) if (!definition.params.some(param => param.key === key)) throw new Error(`${definition.id} 没有参数 ${key}，不能改它的默认值。`)
  return definition.params.filter(param => !options.keys || options.keys.includes(param.key)).map(param => ({
    ...param, key: `${prefix}_${param.key}`, group,
    ...(param.key in overrides ? { default: overrides[param.key].default, description: overrides[param.key].text } : {}),
    ...(param.visibleWhen ? { visibleWhen: { ...param.visibleWhen, param: `${prefix}_${param.visibleWhen.param}` } } : {}),
  }) as VideoEditBuiltinParam)
}

/** 从当前效果的参数里取回被包含效果自己的参数（去掉前缀）。 */
export function includedEffectValues(params: VideoEditBuiltinParams, prefix: string): VideoEditBuiltinParams {
  const head = `${prefix}_`
  return Object.fromEntries(Object.entries(params).filter(([key]) => key.startsWith(head)).map(([key, value]) => [key.slice(head.length), value]))
}
