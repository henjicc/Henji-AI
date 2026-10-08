/**
 * `shaders` 组件作为剪辑内置效果：每个生成器、滤镜组件一项，参数由组件属性自动换算。
 *
 * - 效果 ID 为 `shaders.<组件名>`；渲染时组成着色器图 `[@input, 组件]`（见 `shaderGraphEffectSpec`）。
 * - 数值、颜色、选项、开关直接对应；位置拆成 `<键>_x` / `<键>_y` 两个百分比（0 左/上，100 右/下）。
 * - 渐变色标、形状、文字等结构化属性不进效果参数（取组件默认值）；需要时在代码素材的 shader 图层里写全。
 * - 生成器多一个 `blend_mode`：生成的画面怎样叠在原画面上；效果“数量”仍是与原画面的混合比例。
 */
import type { VideoEditBuiltinEffectDefinition, VideoEditBuiltinGroup, VideoEditBuiltinParam, VideoEditBuiltinParams } from '../builtinEffects'
import { SHADER_BLEND_MODES, SHADER_COMPONENTS, SHADER_GRAPH_INPUT, type ShaderComponent, type ShaderComponentProp, type ShaderGraphSpec } from './spec'
import { SHADER_COMPONENT_ZH, SHADER_LABEL_ZH, SHADER_OPTION_ZH } from './zh'
import { BLACK_HEX } from '../../theme/colorTokens'

export const SHADER_EFFECT_PREFIX = 'shaders.'
const GROUPS: Readonly<Record<string, VideoEditBuiltinGroup>> = {
  Textures: 'shader_texture', Shapes: 'shader_shape', 'Shape Effects': 'shader_material', Blurs: 'shader_blur', Distortions: 'shader_distort', Adjustments: 'shader_adjust', Stylize: 'shader_stylize',
}
const BLEND_ZH: Readonly<Record<string, string>> = {
  normal: '正常', multiply: '正片叠底', screen: '滤色', overlay: '叠加', softLight: '柔光', hardLight: '强光', linearDodge: '线性减淡（添加）', linearBurn: '线性加深', colorDodge: '颜色减淡', colorBurn: '颜色加深',
  darken: '变暗', lighten: '变亮', difference: '差值', exclusion: '排除', hue: '色相', saturation: '饱和度', color: '颜色', luminosity: '明度',
}

function color(value: unknown): string {
  if (typeof value !== 'string') return BLACK_HEX
  const text = value.trim().toLowerCase()
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(text)) return text
  if (/^#[0-9a-f]{3}$/.test(text)) return `#${[...text.slice(1)].map(char => char + char).join('')}`
  return text === 'transparent' ? `${BLACK_HEX}00` : BLACK_HEX
}
const label = (prop: ShaderComponentProp): string => SHADER_LABEL_ZH[prop.label] ?? prop.label
/** 效果参数键沿用剪辑的下划线写法（组件的 colorA → color_a），读写实体与关键帧都用它。 */
export const shaderParamKey = (key: string): string => key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)
/** 位置属性拆成的两个百分比参数键。 */
export const shaderPositionKeys = (key: string): readonly [string, string] => [`${shaderParamKey(key)}_x`, `${shaderParamKey(key)}_y`]

function params(component: ShaderComponent): VideoEditBuiltinParam[] {
  const result: VideoEditBuiltinParam[] = []
  for (const prop of component.props) {
    const base = { key: shaderParamKey(prop.key), name: label(prop), tooltip: '', description: prop.description || prop.label }
    if (prop.ui === 'range' && typeof prop.default === 'number' && Number.isFinite(prop.default)) {
      const min = prop.min ?? Math.min(0, prop.default); const max = prop.max ?? Math.max(1, prop.default * 4)
      result.push({ ...base, type: 'number', unit: 'value', min, max, step: prop.step ?? (max - min > 20 ? 1 : 0.01), default: prop.default, animatable: prop.key !== component.speedProp && !prop.compileTime })
    } else if (prop.ui === 'color') result.push({ ...base, type: 'color', default: color(prop.default), alpha: true, animatable: true })
    else if (prop.ui === 'select' && prop.options?.length) result.push({ ...base, type: 'enum', default: String(prop.default ?? prop.options[0].value), options: prop.options.map(option => ({ value: String(option.value), label: SHADER_OPTION_ZH[option.label] ?? option.label })) })
    else if (prop.ui === 'checkbox') result.push({ ...base, type: 'boolean', default: prop.default === true })
    else if (prop.ui === 'position' && prop.default && typeof prop.default === 'object') {
      const point = prop.default as { x?: number; y?: number }
      const [x, y] = shaderPositionKeys(prop.key)
      result.push({ ...base, key: x, name: `${label(prop)}（水平）`, type: 'number', unit: 'percent', min: -100, max: 200, step: 0.1, default: Math.round((point.x ?? 0.5) * 1000) / 10, description: `${base.description}（水平位置，0 左边缘，100 右边缘）`, animatable: true })
      result.push({ ...base, key: y, name: `${label(prop)}（垂直）`, type: 'number', unit: 'percent', min: -100, max: 200, step: 0.1, default: Math.round((point.y ?? 0.5) * 1000) / 10, description: `${base.description}（垂直位置，0 上边缘，100 下边缘）`, animatable: true })
    }
  }
  if (component.role === 'generator') result.push({ key: 'blend_mode', name: '混合模式', type: 'enum', default: 'normal', tooltip: '生成的画面怎样叠在原画面上', description: '生成画面与片段原画面的混合模式：normal 直接覆盖（透明处露出原画面），screen 只提亮，multiply 只压暗，overlay 加强对比等。', options: SHADER_BLEND_MODES.map(value => ({ value, label: BLEND_ZH[value] ?? value })) })
  return result
}

/** 可作为片段效果的组件：生成器与滤镜（转场另行登记，分组容器不单独成效果）。 */
export const SHADER_GRAPH_EFFECT_DEFINITIONS: readonly VideoEditBuiltinEffectDefinition[] = SHADER_COMPONENTS
  .filter(component => (component.role === 'generator' || component.role === 'filter') && GROUPS[component.category])
  .map(component => {
    const zh = SHADER_COMPONENT_ZH[component.name]
    return {
      id: `${SHADER_EFFECT_PREFIX}${component.name}`, name: zh?.[0] ?? component.name, group: GROUPS[component.category],
      tooltip: zh?.[1] ?? component.description,
      description: `${component.role === 'generator' ? '生成画面（覆盖片段画面，可用 blend_mode 混合）' : '处理片段画面的滤镜'}：${component.description}${component.speedProp ? `（动画速度由 ${component.speedProp} 控制，不能做关键帧）` : ''}`,
      params: params(component),
      cover: { kind: 'render', timeSeconds: 1.5 },
    }
  })
const BY_ID = new Map(SHADER_GRAPH_EFFECT_DEFINITIONS.map(definition => [definition.id, definition]))
export function isShaderGraphEffect(id: string): boolean { return BY_ID.has(id) }

/** 效果参数 → 组件属性：位置合回 {x, y}（百分比转 0–1），选项值还原成组件原类型。 */
export function shaderGraphEffectProps(id: string, values: Readonly<VideoEditBuiltinParams>): Record<string, unknown> {
  const component = SHADER_COMPONENTS.find(value => `${SHADER_EFFECT_PREFIX}${value.name}` === id)
  if (!component) throw new Error(`没有着色器效果 ${id}。`)
  const props: Record<string, unknown> = {}
  for (const prop of component.props) {
    if (prop.ui === 'position') {
      const [x, y] = shaderPositionKeys(prop.key)
      if (typeof values[x] === 'number' || typeof values[y] === 'number') {
        const point = (prop.default ?? {}) as { x?: number; y?: number }
        props[prop.key] = { x: typeof values[x] === 'number' ? (values[x] as number) / 100 : point.x ?? 0.5, y: typeof values[y] === 'number' ? (values[y] as number) / 100 : point.y ?? 0.5 }
      }
    } else if (shaderParamKey(prop.key) in values) {
      const value = values[shaderParamKey(prop.key)]
      props[prop.key] = prop.ui === 'select' ? prop.options?.find(option => String(option.value) === value)?.value ?? value : value
    }
  }
  if (component.role === 'generator' && typeof values.blend_mode === 'string') props.blendMode = values.blend_mode
  return props
}

/** 一项着色器效果对应的着色器图：先画片段画面，再叠生成器或套滤镜。组件图层 id 固定为 `fx`。 */
export function shaderGraphEffectSpec(id: string): ShaderGraphSpec {
  return { layers: [{ type: SHADER_GRAPH_INPUT }, { type: id.slice(SHADER_EFFECT_PREFIX.length), id: 'fx' }] }
}
