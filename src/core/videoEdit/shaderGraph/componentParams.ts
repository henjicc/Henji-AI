/**
 * `shaders` 组件属性与剪辑参数之间的换算（片段效果、封装效果与过渡共用）。
 *
 * - 数值、颜色、选项、开关直接对应；位置拆成 `<键>_x` / `<键>_y` 两个百分比（0 左/上，100 右/下）。
 * - 渐变色标、形状、文字等结构化属性不进效果参数，取组件默认值。
 * - 生成器多一个 `blend_mode`：生成的画面怎样叠在原画面上；效果“数量”仍是与原画面的混合比例。
 */
import type { VideoEditBuiltinParam, VideoEditBuiltinParams } from '../builtinEffects'
import { SHADER_BLEND_MODES, shaderClockRateProps, type ShaderComponent, type ShaderComponentProp } from './spec'
import { SHADER_LABEL_ZH, SHADER_OPTION_ZH } from './zh'
import { BLACK_HEX } from '../../theme/colorTokens'

const BLEND_ZH: Readonly<Record<string, string>> = {
  normal: '正常', multiply: '正片叠底', screen: '滤色', overlay: '叠加', softLight: '柔光', hardLight: '强光', linearDodge: '线性减淡（添加）', linearBurn: '线性加深', colorDodge: '颜色减淡', colorBurn: '颜色加深',
  darken: '变暗', lighten: '变亮', difference: '差值', exclusion: '排除', hue: '色相', saturation: '饱和度', color: '颜色', luminosity: '明度',
}

function shaderColor(value: unknown): string {
  if (typeof value !== 'string') return BLACK_HEX
  const text = value.trim().toLowerCase()
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(text)) return text
  if (/^#[0-9a-f]{3}$/.test(text)) return `#${[...text.slice(1)].map(char => char + char).join('')}`
  return text === 'transparent' ? `${BLACK_HEX}00` : BLACK_HEX
}
const label = (prop: ShaderComponentProp): string => SHADER_LABEL_ZH[prop.label] ?? prop.label
/** 效果参数键沿用剪辑的下划线写法（组件的 colorA → color_a），读写实体与关键帧都用它。 */
const shaderParamKey = (key: string): string => key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)
/** 位置属性拆成的两个百分比参数键。 */
const shaderPositionKeys = (key: string): readonly [string, string] => [`${shaderParamKey(key)}_x`, `${shaderParamKey(key)}_y`]

/** 生成器的混合模式参数：生成的画面怎样叠在片段画面上。 */
export function shaderBlendModeParam(group?: string): VideoEditBuiltinParam {
  return { key: 'blend_mode', name: '混合模式', type: 'enum', default: 'normal', ...(group ? { group } : { tooltip: '生成的画面怎样叠在原画面上' }), description: group ? '生成的画面怎样叠在内容上，只在内容范围里。正常（默认）直接盖上，生成画面透明的地方露出内容；滤色只提亮，正片叠底只压暗，叠加加强对比。' : '生成画面与片段原画面的混合模式：normal 直接覆盖（透明处露出原画面），screen 只提亮，multiply 只压暗，overlay 加强对比等。', options: SHADER_BLEND_MODES.map(value => ({ value, label: BLEND_ZH[value] ?? value })) }
}

/** 组件属性 → 剪辑参数（效果与过渡共用）；`skip` 里的属性由宿主驱动（如转场进度），不做参数。 */
export function shaderComponentParams(component: ShaderComponent, skip: readonly string[] = []): VideoEditBuiltinParam[] {
  const result: VideoEditBuiltinParam[] = []
  const clockRates = shaderClockRateProps(component)
  for (const prop of component.props) {
    if (skip.includes(prop.key)) continue
    // 助手语义里写明代码素材里的属性名：效果参数用下划线键，代码图层用组件原名（两种写法代码里都认）。
    const base = { key: shaderParamKey(prop.key), name: label(prop), tooltip: '', description: `${prop.description || prop.label}（代码图层属性 ${prop.key}）` }
    if (prop.ui === 'range' && typeof prop.default === 'number' && Number.isFinite(prop.default)) {
      const min = prop.min ?? Math.min(0, prop.default); const max = prop.max ?? Math.max(1, prop.default * 4)
      result.push({ ...base, type: 'number', unit: 'value', min, max, step: prop.step ?? (max - min > 20 ? 1 : 0.01), default: prop.default, animatable: !clockRates.includes(prop.key) && !prop.compileTime, ...(clockRates.includes(prop.key) && prop.key !== component.speedProp ? { storedKeyframes: 'first' as const } : {}) })
    } else if (prop.ui === 'color') result.push({ ...base, type: 'color', default: shaderColor(prop.default), alpha: true, animatable: true })
    else if (prop.ui === 'select' && prop.options?.length) result.push({ ...base, type: 'enum', default: String(prop.default ?? prop.options[0].value), options: prop.options.map(option => ({ value: String(option.value), label: SHADER_OPTION_ZH[option.label] ?? option.label })) })
    else if (prop.ui === 'checkbox') result.push({ ...base, type: 'boolean', default: prop.default === true })
    else if (prop.ui === 'position' && prop.default && typeof prop.default === 'object') {
      const point = prop.default as { x?: number; y?: number }
      const [x, y] = shaderPositionKeys(prop.key)
      result.push({ ...base, key: x, name: `${label(prop)}（水平）`, type: 'number', unit: 'percent', min: -100, max: 200, step: 0.1, default: Math.round((point.x ?? 0.5) * 1000) / 10, description: `${prop.description || prop.label}（水平位置百分比，0 左边缘，100 右边缘；代码图层写 ${prop.key}: {x, y}，取 0–1）`, animatable: true })
      result.push({ ...base, key: y, name: `${label(prop)}（垂直）`, type: 'number', unit: 'percent', min: -100, max: 200, step: 0.1, default: Math.round((point.y ?? 0.5) * 1000) / 10, description: `${prop.description || prop.label}（垂直位置百分比，0 上边缘，100 下边缘；代码图层写 ${prop.key}: {x, y}，取 0–1）`, animatable: true })
    }
  }
  if (component.role === 'generator') result.push(shaderBlendModeParam())
  return result
}

/** 剪辑参数 → 组件属性：位置合回 {x, y}（百分比转 0–1），选项值还原成组件原类型（效果与过渡共用）。 */
export function shaderComponentProps(component: ShaderComponent, values: Readonly<VideoEditBuiltinParams>): Record<string, unknown> {
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
