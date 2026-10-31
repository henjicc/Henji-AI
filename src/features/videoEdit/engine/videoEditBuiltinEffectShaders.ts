import * as index from './effectPlannerIndex'
import { VIDEO_EDIT_EFFECT_PLANNERS } from './effectPlanners'
import { assembleEffectShader, EFFECT_SHADER_PRELUDE, EFFECT_SHARED_ENTRIES, EFFECT_UNFILTERED_SHARED_ENTRIES } from './effectShaderPrelude'

type Registration = typeof index[keyof typeof index]
type Planner = Registration extends infer T ? T extends readonly unknown[] ? T[number] : T : never
export type VideoEditBuiltinEffectEntry = Planner['entries'][number] | typeof EFFECT_SHARED_ENTRIES[number]
// 索引中的任一登记被注解成宽 string 时，装配必须编译失败，不能取消全部入口校验。
export const VIDEO_EDIT_BUILTIN_EFFECT_ENTRIES: string extends VideoEditBuiltinEffectEntry ? never : readonly VideoEditBuiltinEffectEntry[] = [...new Set([...EFFECT_SHARED_ENTRIES, ...VIDEO_EDIT_EFFECT_PLANNERS.flatMap(planner => planner.entries)])] as VideoEditBuiltinEffectEntry[]
/** 数据纹理只允许 textureLoad；入口随拥有它的规划声明。 */
export const VIDEO_EDIT_UNFILTERED_SOURCE_ENTRIES: ReadonlySet<VideoEditBuiltinEffectEntry> = new Set([...EFFECT_UNFILTERED_SHARED_ENTRIES, ...VIDEO_EDIT_EFFECT_PLANNERS.flatMap(planner => planner.unfilteredSourceEntries ?? [])] as VideoEditBuiltinEffectEntry[])
export const VIDEO_EDIT_BUILTIN_EFFECT_SHADER = assembleEffectShader([
  ...EFFECT_SHADER_PRELUDE,
  ...VIDEO_EDIT_EFFECT_PLANNERS.flatMap(planner => planner.shared ?? []),
  ...VIDEO_EDIT_EFFECT_PLANNERS.filter(planner => planner.wgsl).map(planner => ({ name: `effect:${planner.id}`, wgsl: planner.wgsl })),
])
