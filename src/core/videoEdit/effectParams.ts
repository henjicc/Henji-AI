import type { VideoEditBuiltinParam } from './builtinEffects'

const strength = (key: string, name: string, fallback: number, tooltip: string, description: string): VideoEditBuiltinParam => ({ key, name, type: 'number', unit: 'strength', min: 0, max: 100, step: 1, default: fallback, tooltip, description })
const percent = (key: string, name: string, fallback: number, tooltip: string, description: string): VideoEditBuiltinParam => ({ key, name, type: 'number', unit: 'percent', min: 0, max: 100, step: 1, default: fallback, tooltip, description })
/** 参数构造（过渡参数登记复用，量纲与内置效果一致）。 */
export { strength as videoEditStrengthParam, percent as videoEditPercentParam }
