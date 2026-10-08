/**
 * `shaders` 框架的转场组件作为剪辑视频过渡（种类 `shaders.<组件名>`）。
 *
 * 框架转场是“揭示”滤镜：把它里面的画面按进度擦掉。剪辑里组成
 * `[@second（后一段）, 转场{children: [@input（前一段）]}]`，进度由时间线驱动（不做参数）。
 * 单侧过渡空着的一侧传透明画面。过渡参数不做关键帧（与其它过渡一致）。
 */
import type { VideoEditBuiltinParam, VideoEditBuiltinParams } from '../builtinEffects'
import { SHADER_GRAPH_INPUT, SHADER_GRAPH_SECOND, shaderComponent, type ShaderComponent, type ShaderGraphSpec } from './spec'
import { SHADER_EFFECT_PREFIX, shaderComponentParams, shaderComponentProps } from './effects'
import { SHADER_GRAPH_TRANSITION_KINDS } from './transitionKinds.generated'
import { SHADER_COMPONENT_ZH } from './zh'

export { SHADER_GRAPH_TRANSITION_KINDS }
export type ShaderGraphTransitionKind = typeof SHADER_GRAPH_TRANSITION_KINDS[number]

function component(kind: string): ShaderComponent {
  const value = shaderComponent(kind.slice(SHADER_EFFECT_PREFIX.length))
  if (!value || value.role !== 'transition') throw new Error(`没有着色器转场 ${kind}。`)
  return value
}
/** 由时间线驱动的进度属性：多数转场叫 progress（0 完整显示前一段，1 完全擦掉），翻页叫 amount。 */
function progressProp(value: ShaderComponent): string { return value.props.some(prop => prop.key === 'progress') ? 'progress' : 'amount' }

export function isShaderGraphTransition(kind: string): kind is ShaderGraphTransitionKind { return (SHADER_GRAPH_TRANSITION_KINDS as readonly string[]).includes(kind) }

export const SHADER_GRAPH_TRANSITION_PRESETS = SHADER_GRAPH_TRANSITION_KINDS.map(kind => {
  const value = component(kind); const zh = SHADER_COMPONENT_ZH[value.name]
  return { kind, medium: 'video' as const, name: zh?.[0] ?? value.name, tooltip: zh?.[1] ?? value.description, description: `着色器转场：${value.description}。前一段被擦掉，露出后一段。` }
})
export const SHADER_GRAPH_TRANSITION_PARAMS: Readonly<Record<ShaderGraphTransitionKind, readonly VideoEditBuiltinParam[]>> = Object.fromEntries(SHADER_GRAPH_TRANSITION_KINDS.map(kind => {
  const value = component(kind)
  return [kind, shaderComponentParams(value, [progressProp(value)]).map(param => ({ ...param, animatable: false }))]
})) as unknown as Record<ShaderGraphTransitionKind, readonly VideoEditBuiltinParam[]>

/** 转场的着色器图；转场图层 id 固定为 `fx`。 */
export function shaderGraphTransitionSpec(kind: ShaderGraphTransitionKind): ShaderGraphSpec {
  return { layers: [{ type: SHADER_GRAPH_SECOND }, { type: component(kind).name, id: 'fx', children: [{ type: SHADER_GRAPH_INPUT }] }] }
}
export function shaderGraphTransitionProps(kind: ShaderGraphTransitionKind, params: Readonly<VideoEditBuiltinParams>, progress: number): Record<string, unknown> {
  const value = component(kind)
  return { ...shaderComponentProps(value, params), [progressProp(value)]: Math.min(1, Math.max(0, progress)) }
}
