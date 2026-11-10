/**
 * `shaders` 组件作为剪辑内置效果：每个滤镜组件一项，参数由组件属性自动换算（`componentParams.ts`）；
 * 生成器按方式合并成封装效果（`generators.ts`），进“生成”文件夹。
 *
 * - 效果 ID 为 `shaders.<组件名>`；渲染时组成着色器图 `[@input, 组件]`（见 `shaderGraphEffectSpec`）。
 * - “生成”文件夹的生成器只在内容 alpha 内生成：组件图层以片段画面的 alpha 为遮罩，再按混合模式叠上去。
 */
import type { VideoEditBuiltinEffectDefinition, VideoEditBuiltinGroup, VideoEditBuiltinParams } from '../builtinEffects'
import { SHADER_COMPONENTS, SHADER_GRAPH_INPUT, shaderComponent, shaderGraphStructureKey, type ShaderGraphCustomShader, type ShaderGraphSpec } from './spec'
import { SHADER_COMPONENT_ZH } from './zh'
import { FILM_LOOK_SHADER_GRAPH } from '../filmLook'
import { RETRO_SCREEN_SHADER_GRAPH } from '../retroScreen'
import { WRAPPED_GENERATOR_SHADER_GRAPHS, WRAPPED_GENERATOR_SOURCES } from '../generators'
import { shaderComponentParams, shaderComponentProps } from './componentParams'

export { shaderComponentParams, shaderComponentProps } from './componentParams'
export const SHADER_EFFECT_PREFIX = 'shaders.'
const GROUPS: Readonly<Record<string, VideoEditBuiltinGroup>> = {
  Textures: 'shader_texture', 'Shape Effects': 'shader_material', Blurs: 'shader_blur', Distortions: 'shader_distort', Adjustments: 'shader_adjust', Stylize: 'shader_stylize',
}

/**
 * 与剪辑内置效果同目的的组件不单独列为效果，剪辑里用对应的内置效果：
 * 黑白、反相、翻转；模糊（高斯、方向、缩放、镜头虚化，旋转、移轴、渐进并入“模糊”的方式与范围）、锐度、
 * 调色（亮度对比度、曝光、饱和度、色相、自然饱和度、着色）、色调分离、渐变映射（含双色、三色调）、胶片模拟；
 * 颗粒、暗角、像素化（并入马赛克）、投影、发光、色差；半调网点、抖动点阵、纸张、划痕、老式画面（录像带、显像管）；
 * 故障（含条带错位、压缩失真）、镜头光晕、漏光；镜像、重复阵列、膨胀（含球面化）、旋转扭曲（含同心旋转）、
 * 波动（含流场）、边角定位、置换；八种渐变与色轮（并入“渐变”）。
 */
const SAME_AS_BUILTIN = new Set(['Grayscale', 'Invert', 'Flip', 'Blur', 'LinearBlur', 'ZoomBlur', 'BokehBlur', 'AngularBlur', 'TiltShift', 'ProgressiveBlur', 'Sharpness',
  'BrightnessContrast', 'Exposure', 'Saturation', 'HueShift', 'Vibrance', 'Tint', 'Posterize', 'Duotone', 'Tritone', 'GradientMap', 'FilmStock',
  'FilmGrain', 'Vignette', 'Pixelate', 'DropShadow', 'Glow', 'ChromaticAberration', 'Halftone', 'Dither', 'Paper', 'Scratches', 'VHS', 'CRTScreen',
  'Glitch', 'BarShift', 'CompressionArtifacts', 'LensFlare', 'LightLeak',
  'Mirror', 'Repeater', 'Bulge', 'Spherize', 'Twirl', 'ConcentricSpin', 'WaveDistortion', 'FlowField', 'CornerPin', 'DisplacementMap',
  'LinearGradient', 'RadialGradient', 'ConicGradient', 'DiamondGradient', 'MultiPointGradient', 'MeshGradient', 'FlowingGradient', 'ColorWheel'])
/** 图形工具与代码都能画的图形（Shapes 分组整组不登记）、纯色、立体感重的流体团、分通道模糊、扩散模糊、负感，都不作为效果登记。 */
const RETIRED = new Set(['SolidColor', 'Blob', 'ChannelBlur', 'DiffuseBlur', 'Solarize'])
/** 可作为片段效果的组件：滤镜与没有并入“生成”的生成器（转场另行登记，分组容器不单独成效果）。 */
export const SHADER_GRAPH_EFFECT_DEFINITIONS: readonly VideoEditBuiltinEffectDefinition[] = SHADER_COMPONENTS
  .filter(component => (component.role === 'generator' || component.role === 'filter') && GROUPS[component.category] && !SAME_AS_BUILTIN.has(component.name) && !RETIRED.has(component.name) && !WRAPPED_GENERATOR_SOURCES.has(component.name))
  .map(component => {
    const zh = SHADER_COMPONENT_ZH[component.name]
    return {
      id: `${SHADER_EFFECT_PREFIX}${component.name}`, name: zh?.[0] ?? component.name, group: GROUPS[component.category],
      tooltip: zh?.[1] ?? component.description,
      description: `${component.role === 'generator' ? '生成画面（覆盖片段画面，可用 blend_mode 混合）' : '处理片段画面的滤镜'}：${component.description}${component.speedProp ? `（动画速度由 ${component.speedProp} 控制，不能做关键帧）` : ''}`,
      params: shaderComponentParams(component),
      cover: { kind: 'render', timeSeconds: 1.5 },
    }
  })
const BY_ID = new Map(SHADER_GRAPH_EFFECT_DEFINITIONS.map(definition => [definition.id, definition]))
/**
 * 封装效果：一个或几个组件登记成有自己名字和一份说明的内置效果（定义随效果登记），渲染时按参数选组件、换算回组件属性。
 * 着色器不重写，所以只上片段，出口仍是着色器图的 8 位。`component` 随参数变化时（按“方式”分派），不同方式是不同的合成结构。
 */
export interface ShaderGraphWrappedEffect {
  readonly id: string
  readonly component: string | ((values: Readonly<VideoEditBuiltinParams>) => string)
  readonly props: (values: Readonly<VideoEditBuiltinParams>) => Record<string, unknown>
  readonly keepsSourceAlpha?: (values: Readonly<VideoEditBuiltinParams>) => boolean
}
const WRAPPED: ReadonlyMap<string, ShaderGraphWrappedEffect> = new Map([FILM_LOOK_SHADER_GRAPH, RETRO_SCREEN_SHADER_GRAPH, ...WRAPPED_GENERATOR_SHADER_GRAPHS].map(wrapped => [wrapped.id, wrapped]))
export function shaderGraphEffectKeepsSourceAlpha(id: string, values: Readonly<VideoEditBuiltinParams>): boolean { return WRAPPED.get(id)?.keepsSourceAlpha?.(values) ?? false }
export function isShaderGraphEffect(id: string): boolean { return BY_ID.has(id) || WRAPPED.has(id) }

/** 生成器遮罩引用的片段画面图层 id。 */
const CONTENT_LAYER = 'content'
const SHADER_GROUP = 'Group'
/** 片段画面换成不透明的直通色（图层纹理是预乘的）：混合只看颜色，透明度由外层遮罩一次给出。 */
const OPAQUE_CONTENT: ShaderGraphCustomShader = { name: 'OpaqueContent', kind: 'filter', wgsl: 'return vec4f(child.rgb / max(child.a, 0.0001), 1.0);' }
function effectComponent(id: string, values: Readonly<VideoEditBuiltinParams>): string {
  const wrapped = WRAPPED.get(id)
  if (!wrapped) return id.slice(SHADER_EFFECT_PREFIX.length)
  return typeof wrapped.component === 'string' ? wrapped.component : wrapped.component(values)
}
/** “生成”文件夹的封装生成器只在内容 alpha 内生成；留在“更多”里的组件效果保持原样（铺满画面）。 */
const MASKED_GENERATORS: ReadonlySet<string> = new Set(WRAPPED_GENERATOR_SHADER_GRAPHS.map(graph => graph.id))

/** 效果参数 → 组件属性。 */
export function shaderGraphEffectProps(id: string, values: Readonly<VideoEditBuiltinParams>): Record<string, unknown> {
  const wrapped = WRAPPED.get(id)
  const component = shaderComponent(effectComponent(id, values))
  if (!component) throw new Error(`没有着色器效果 ${id}。`)
  const props = wrapped ? wrapped.props(values) : shaderComponentProps(component, values)
  return props
}

/**
 * 一项着色器效果对应的着色器图：先画片段画面，再套滤镜或叠生成器。组件图层 id 固定为 `fx`。
 * “生成”文件夹的生成器叠在片段画面上（同 PS 剪贴蒙版）：先把片段画面换成不透明的直通色，生成器按混合模式叠上去，
 * 整组再以片段画面的 alpha 为遮罩。只在内容范围里生成，透明处保持透明（拖到圆角卡片上就是卡片形状），
 * 半透明边的透明度就是内容的透明度，生成器透明处露出内容本来的颜色。框架会把遮罩源图层也画出来，所以遮罩源放进不显示的分组。
 * `values` 决定按方式分派的封装效果用哪个组件。
 */
export function shaderGraphEffectSpec(id: string, values: Readonly<VideoEditBuiltinParams> = {}): ShaderGraphSpec {
  const type = effectComponent(id, values)
  return MASKED_GENERATORS.has(id)
    ? { layers: [
      { type: SHADER_GROUP, id: 'content-source', props: { visible: false }, children: [{ type: SHADER_GRAPH_INPUT, id: CONTENT_LAYER }] },
      { type: SHADER_GROUP, id: 'generated', props: { maskSource: CONTENT_LAYER, maskType: 'alpha' }, children: [{ type: SHADER_GRAPH_INPUT }, { type: OPAQUE_CONTENT.name }, { type, id: 'fx' }] },
    ], shaders: [OPAQUE_CONTENT] }
    : { layers: [{ type: SHADER_GRAPH_INPUT }, { type, id: 'fx' }] }
}

/**
 * 剪辑里静态可知的着色器图（片段效果、着色器转场），用于后台预热：新结构首次编译约半秒，
 * 放在打开剪辑/加效果时做，播放到那一段时就不再卡一下。
 */
export function videoEditShaderGraphWarmSpecs(sequences: ReadonlyArray<{ clips: ReadonlyArray<{ effects?: ReadonlyArray<{ builtin?: { id: string; params?: Readonly<VideoEditBuiltinParams> } }> }>; transitions?: ReadonlyArray<{ kind: string; parameters?: Readonly<VideoEditBuiltinParams> }> }>, transitionSpec: (kind: string, parameters?: Readonly<VideoEditBuiltinParams>) => ShaderGraphSpec | undefined): ShaderGraphSpec[] {
  const specs = new Map<string, ShaderGraphSpec>()
  const add = (spec: ShaderGraphSpec): void => { specs.set(shaderGraphStructureKey(spec), spec) }
  for (const sequence of sequences) {
    for (const clip of sequence.clips) for (const effect of clip.effects ?? []) if (effect.builtin && isShaderGraphEffect(effect.builtin.id)) add(shaderGraphEffectSpec(effect.builtin.id, effect.builtin.params))
    for (const transition of sequence.transitions ?? []) { const spec = transitionSpec(transition.kind, transition.parameters); if (spec) add(spec) }
  }
  return [...specs.values()]
}
