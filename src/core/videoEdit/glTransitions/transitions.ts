/**
 * gl-transitions 转场作为剪辑视频过渡（种类 `gl.<名>`，来源与收录规则见 `scripts/generate-gl-transitions.cjs`）。
 *
 * - 进度由时间线驱动（不做参数）：0 是前一段，1 是后一段；`ratio` 由画面宽高比给出。
 * - 参数按上游 uniform 自动换算：数值、开关直接对应；颜色写 `#rrggbb`（vec4 颜色可带透明度 `#rrggbbaa`）；
 *   选项型整数（方框位置、翻滚角）按 zh.json 登记成选项；位置拆成 `<键>_x` / `<键>_y` 两个百分比（0 左/上，100 右/下），
 *   其余向量按分量拆开。中文名、分组与范围在 zh.json，缺的回落为上游写法。
 * - 着色器取样还原直通色、输出再预乘透明度，单侧过渡空着的一侧是透明画面（与其他过渡一致）。
 */
import type { VideoEditBuiltinParam, VideoEditBuiltinParams } from '../builtinEffects'
import { GL_TRANSITION_CATALOG, GL_TRANSITION_KINDS, type GlTransitionCatalogEntry, type GlTransitionCatalogParam } from './catalog.generated'
import data from './zh.json'

export { GL_TRANSITION_KINDS, GL_TRANSITIONS_PACKAGE } from './catalog.generated'
export type GlTransitionKind = typeof GL_TRANSITION_KINDS[number]
export const GL_TRANSITION_PREFIX = 'gl.'

interface CuratedParam { label?: string; min?: number; max?: number; step?: number; position?: boolean; direction?: boolean; options?: Readonly<Record<string, string>> }
interface Curated { group: string; name: string; tooltip: string; params?: Readonly<Record<string, string | CuratedParam>> }
const GROUPS = data.groups as Readonly<Record<string, string>>
const CURATED = data.transitions as unknown as Readonly<Record<string, Curated>>
const GROUP_ORDER = Object.keys(GROUPS)
const BY_KIND = new Map(GL_TRANSITION_CATALOG.map(entry => [`${GL_TRANSITION_PREFIX}${entry.name}`, entry]))

export function isGlTransition(kind: string): kind is GlTransitionKind { return BY_KIND.has(kind) }
function entry(kind: string): GlTransitionCatalogEntry {
  const value = BY_KIND.get(kind)
  if (!value) throw new Error(`没有 GL 转场 ${kind}。`)
  return value
}
/** 着色器名（`gl.Cube` → `Cube`）。 */
export function glTransitionName(kind: GlTransitionKind): string { return entry(kind).name }

/** 参数键沿用剪辑的下划线写法：rectIn → rect_in，FadeInSecond → fade_in_second。 */
export const glParamKey = (key: string): string => key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
function curated(name: string, key: string): CuratedParam {
  const value = CURATED[name]?.params?.[key]
  return typeof value === 'string' ? { label: value } : value ?? {}
}
const hex = (value: number): string => Math.round(Math.min(1, Math.max(0, value)) * 255).toString(16).padStart(2, '0')
const round = (value: number): number => Math.round(value * 1e6) / 1e6

/** 一个上游参数展开成的剪辑参数，以及它们回填 uniform 的方式。 */
interface Expanded { params: VideoEditBuiltinParam[]; read: (values: Readonly<VideoEditBuiltinParams>) => number[] }
const COMPONENTS: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
  vec2: [['x', '水平'], ['y', '垂直']], ivec2: [['x', '横向个数'], ['y', '纵向个数']],
  vec3: [['x', 'X'], ['y', 'Y'], ['z', 'Z']], vec4: [['r', '红'], ['g', '绿'], ['b', '蓝'], ['a', '透明度']],
}
function numberParam(base: { key: string; name: string; description: string }, fallback: number, hint: CuratedParam, source: GlTransitionCatalogParam, integer: boolean): VideoEditBuiltinParam {
  let min = hint.min ?? source.min ?? (fallback < 0 ? fallback * 4 : 0)
  let max = hint.max ?? source.max ?? (fallback > 0 ? fallback * 4 : fallback < 0 ? -fallback * 4 : 1)
  min = Math.min(min, fallback); max = Math.max(max, fallback)
  const step = integer ? Math.max(1, Math.round(hint.step ?? source.step ?? 1)) : hint.step ?? source.step ?? (max - min > 20 ? 1 : 0.01)
  return { ...base, tooltip: '', type: 'number', unit: 'value', min, max, step, default: fallback, animatable: true }
}
function expand(name: string, source: GlTransitionCatalogParam): Expanded {
  const hint = curated(name, source.key); const key = glParamKey(source.key); const label = hint.label ?? source.key
  const about = source.description || label
  const base = { key, name: label, description: `${about}（gl-transitions 参数 ${source.key}）` }
  const value = source.default
  if (source.color && Array.isArray(value)) {
    const alpha = source.type === 'vec4'
    const color = `#${value.slice(0, alpha ? 4 : 3).map(hex).join('')}`
    return {
      params: [{ ...base, tooltip: '', type: 'color', default: color, ...(alpha ? { alpha: true } : {}), animatable: true, description: `${base.description}，写 ${alpha ? '#rrggbbaa（末两位是透明度）' : '#rrggbb'}` }],
      read: values => {
        const text = String(values[key] ?? color)
        const channels = [1, 3, 5, 7].slice(0, alpha ? 4 : 3).map(at => at < text.length ? parseInt(text.slice(at, at + 2), 16) / 255 : 1)
        return channels.map(channel => Number.isFinite(channel) ? channel : 1)
      },
    }
  }
  if (hint.options) {
    const options = Object.entries(hint.options).map(([option, text]) => ({ value: option, label: text }))
    return {
      params: [{ ...base, tooltip: '', type: 'enum', default: String(value), options, description: `${base.description}：${options.map(option => `${option.value} ${option.label}`).join('，')}` }],
      read: values => [Number(values[key] ?? value)],
    }
  }
  if (source.type === 'bool') return { params: [{ ...base, tooltip: '', type: 'boolean', default: value === true }], read: values => [(values[key] ?? value) === true ? 1 : 0] }
  if (typeof value === 'number') {
    const integer = source.type === 'int'
    return { params: [numberParam(base, value, hint, source, integer)], read: values => { const number = Number(values[key] ?? value); return [integer ? Math.round(number) : number] } }
  }
  const vector = value as readonly number[]
  if (hint.position && source.type === 'vec2') {
    // 上游坐标原点在左下角；剪辑位置是左上角起的百分比，垂直方向翻转。
    const [x, y] = [`${key}_x`, `${key}_y`]
    const percent = (axis: string, text: string, fallback: number, edge: string): VideoEditBuiltinParam => ({ key: axis, name: `${label}（${text}）`, tooltip: '', type: 'number', unit: 'percent', min: -100, max: 200, step: 0.1, default: round(fallback), animatable: true, description: `${about}（${text}位置百分比，${edge}；gl-transitions 参数 ${source.key}）` })
    return {
      params: [percent(x, '水平', vector[0] * 100, '0 左边缘，100 右边缘'), percent(y, '垂直', (1 - vector[1]) * 100, '0 上边缘，100 下边缘')],
      read: values => [Number(values[x] ?? vector[0] * 100) / 100, 1 - Number(values[y] ?? (1 - vector[1]) * 100) / 100],
    }
  }
  const parts = COMPONENTS[source.type] ?? []
  const integer = source.type === 'ivec2'
  const params = parts.slice(0, vector.length).map(([suffix, text], index) => {
    const note = hint.direction ? `${text}分量，-1 到 1；垂直分量正值向上` : `${text}分量`
    const param = numberParam({ key: `${key}_${suffix}`, name: `${label}（${text}）`, description: `${about}（${note}；gl-transitions 参数 ${source.key}）` }, vector[index], hint.direction ? { min: -1, max: 1, step: 0.01, ...hint } : hint, source, integer)
    return param
  })
  return { params, read: values => params.map((param, index) => { const number = Number(values[param.key] ?? vector[index]); return integer ? Math.round(number) : number }) }
}

const EXPANDED = new Map(GL_TRANSITION_CATALOG.map(value => [`${GL_TRANSITION_PREFIX}${value.name}`, value.params.map(param => expand(value.name, param))]))

export const GL_TRANSITION_PARAMS: Readonly<Record<GlTransitionKind, readonly VideoEditBuiltinParam[]>> = Object.fromEntries(
  GL_TRANSITION_KINDS.map(kind => [kind, EXPANDED.get(kind)!.flatMap(value => value.params)]),
) as unknown as Record<GlTransitionKind, readonly VideoEditBuiltinParam[]>

/** 效果面板里的过渡：按 zh.json 的分组排列，`group` 是面板里的小标题。 */
export const GL_TRANSITION_PRESETS = [...GL_TRANSITION_KINDS]
  .sort((a, b) => GROUP_ORDER.indexOf(CURATED[entry(a).name].group) - GROUP_ORDER.indexOf(CURATED[entry(b).name].group) || a.localeCompare(b))
  .map(kind => {
    const value = entry(kind); const zh = CURATED[value.name]
    return { kind, medium: 'video' as const, name: zh.name, tooltip: zh.tooltip, group: GROUPS[zh.group], description: `GL 转场：${value.description}。前一段过渡到后一段。` }
  })

/**
 * 参数 → uniform 缓冲（按上游布局逐字节写入，bool 与 int 是 i32）。
 * `ratio` 是画面宽高比；缺的参数取默认值，单侧过渡由调用方传透明画面。
 */
export function glTransitionUniforms(kind: GlTransitionKind, params: Readonly<VideoEditBuiltinParams>, progress: number, ratio: number): ArrayBuffer {
  const value = entry(kind); const expanded = EXPANDED.get(kind)!
  const buffer = new ArrayBuffer(value.size); const view = new DataView(buffer)
  const values: number[][] = [[Math.min(1, Math.max(0, progress))], [ratio], ...expanded.map(item => item.read(params))]
  value.uniforms.forEach((uniform, index) => {
    const integer = uniform.type === 'int' || uniform.type === 'bool' || uniform.type === 'ivec2'
    values[index].forEach((number, component) => {
      const at = uniform.offset + component * 4
      if (integer) view.setInt32(at, Math.trunc(number), true)
      else view.setFloat32(at, number, true)
    })
  })
  return buffer
}
