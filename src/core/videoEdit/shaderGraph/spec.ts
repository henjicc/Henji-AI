/**
 * 着色器图：剪辑里所有 `shaders` 框架画面的唯一描述（效果、转场、代码素材的 shader 图层共用）。
 *
 * - `layers`：图层树，写法与框架的预设 JSON 相同（`type`、`id`、`props`、`children`），先画的在下；
 *   滤镜类组件作用于它之前画好的兄弟图层，或只作用于嵌在它里面的子图层。
 * - 图层类型 `@input` / `@second` 是宿主画面：效果里的片段画面、转场的前后两段。
 * - `shaders`：作者自己写的着色器（WGSL 函数体），定义后像内置组件一样按名字放进图层。
 *
 * 结构（图层树、类型、作者源码）决定渲染会话；属性数值每帧可变，不重建会话。
 */
import { z } from 'zod'
import catalog from './components.generated.json'

export const SHADER_GRAPH_INPUT = '@input'
export const SHADER_GRAPH_SECOND = '@second'

export type ShaderComponentRole = 'generator' | 'filter' | 'transition' | 'group'
export interface ShaderComponentProp {
  key: string
  /** 框架的控件类型：range、color、position、select、checkbox、gradient-stops、shape 等。 */
  ui: string
  mappable?: boolean
  label: string
  description: string
  default?: unknown
  min?: number
  max?: number
  step?: number
  options?: ReadonlyArray<{ value: unknown; label: string }>
  compileTime?: boolean
}
export interface ShaderComponent {
  name: string
  category: string
  description: string
  role: ShaderComponentRole
  /** 声明了“速度”属性的组件：其时间按“秒 × 速度”推进，速度不能做关键帧。 */
  speedProp?: string
  usesPointer?: boolean
  /** 不进入剪辑的原因（见 scripts/shader-component-exclusions.cjs）。 */
  excluded?: string
  props: readonly ShaderComponentProp[]
}

export const SHADER_COMPONENTS_VERSION: string = catalog.version
const ALL = catalog.components as readonly ShaderComponent[]
/** 剪辑可用的组件（排除跟随鼠标、依赖网页或上一帧状态的组件）。 */
export const SHADER_COMPONENTS: readonly ShaderComponent[] = ALL.filter(value => !value.excluded && !value.usesPointer)
const BY_NAME = new Map(SHADER_COMPONENTS.map(value => [value.name, value]))
export function shaderComponent(name: string): ShaderComponent | undefined { return BY_NAME.get(name) }

/** 框架给每个图层的通用属性（混合、透明度、遮罩、变换、包围盒）。 */
export const SHADER_GRAPH_UNIVERSAL_PROPS = ['blendMode', 'opacity', 'visible', 'maskSource', 'maskType', 'transform', 'boundingBox'] as const
export const SHADER_BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'softLight', 'hardLight', 'linearDodge', 'linearBurn', 'colorDodge', 'colorBurn', 'darken', 'lighten', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'] as const

const identifier = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/, '名称只能用字母、数字、下划线，且不以数字开头')
export interface ShaderGraphLayer { type: string; id?: string; props?: Record<string, unknown>; children?: ShaderGraphLayer[] }
export const shaderGraphLayerSchema: z.ZodType<ShaderGraphLayer> = z.lazy(() => z.object({
  type: z.string().min(1).max(64),
  id: z.string().regex(/^[A-Za-z0-9_.:-]{1,64}$/).optional(),
  props: z.record(z.string().max(64), z.unknown()).optional(),
  children: z.array(shaderGraphLayerSchema).optional(),
}).strict())

/** 作者着色器的属性：类型决定 WGSL 里拿到的值（数值 f32、颜色 vec4f 线性光、位置 vec2f、角度弧度、开关 0/1）。 */
export const shaderGraphCustomPropSchema = z.object({
  type: z.enum(['number', 'color', 'position', 'angle', 'boolean']).optional(),
  default: z.union([z.number().finite(), z.string().max(64), z.boolean(), z.object({ x: z.number().finite(), y: z.number().finite() }).strict()]),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  label: z.string().max(64).optional(),
  description: z.string().max(1000).optional(),
}).strict()
export type ShaderGraphCustomProp = z.infer<typeof shaderGraphCustomPropSchema>
export function shaderGraphCustomPropKind(prop: ShaderGraphCustomProp): 'number' | 'color' | 'position' | 'angle' | 'boolean' {
  if (prop.type) return prop.type
  return typeof prop.default === 'string' ? 'color' : typeof prop.default === 'boolean' ? 'boolean' : typeof prop.default === 'object' ? 'position' : 'number'
}

export const shaderGraphCustomShaderSchema = z.object({
  name: identifier,
  /** generator：自己画出画面；filter：处理它之前画好的图层（函数体里可读 child、childTexture）。 */
  kind: z.enum(['generator', 'filter']),
  props: z.record(identifier, shaderGraphCustomPropSchema).optional(),
  /** 一个返回 vec4f 颜色的 WGSL 函数体。 */
  wgsl: z.string().min(1).max(64 * 1024),
  /** 让 time 按“秒 × 这个数值属性”推进（属性名）。 */
  speedProp: identifier.optional(),
  description: z.string().max(2000).optional(),
}).strict()
export type ShaderGraphCustomShader = z.infer<typeof shaderGraphCustomShaderSchema>

export const shaderGraphSpecSchema = z.object({
  layers: z.array(shaderGraphLayerSchema).min(1),
  shaders: z.array(shaderGraphCustomShaderSchema).optional(),
}).strict()
export type ShaderGraphSpec = z.infer<typeof shaderGraphSpecSchema>

/**
 * 校验图结构，返回给作者看的问题（空数组为通过）：组件名、作者着色器重名、图层 id 重复、
 * 宿主画面图层是否允许、遮罩引用。属性值的类型交给框架，WGSL 交给 GPU 编译。
 */
export function shaderGraphIssues(spec: ShaderGraphSpec, allow: { input?: boolean; second?: boolean } = {}): string[] {
  const issues: string[] = []
  const custom = new Map<string, ShaderGraphCustomShader>()
  for (const shader of spec.shaders ?? []) {
    if (custom.has(shader.name)) issues.push(`着色器 ${shader.name} 定义了两次。`)
    if (BY_NAME.has(shader.name)) issues.push(`着色器名 ${shader.name} 与内置组件重名，换一个名字。`)
    if (shader.speedProp && !(shader.props && shader.speedProp in shader.props)) issues.push(`着色器 ${shader.name} 的 speedProp 指向不存在的属性 ${shader.speedProp}。`)
    custom.set(shader.name, shader)
  }
  const ids = new Set<string>()
  const visit = (layers: readonly ShaderGraphLayer[]): void => {
    for (const layer of layers) {
      if (layer.id) { if (ids.has(layer.id)) issues.push(`图层 id ${layer.id} 重复。`); ids.add(layer.id) }
      if (layer.type === SHADER_GRAPH_INPUT) { if (!allow.input) issues.push('@input（输入画面）只能用在效果、滤镜或转场里。') }
      else if (layer.type === SHADER_GRAPH_SECOND) { if (!allow.second) issues.push('@second（转场后段画面）只能用在转场里。') }
      else if (!custom.has(layer.type)) {
        const component = ALL.find(value => value.name === layer.type)
        if (!component) issues.push(`未知组件 ${layer.type}；内置组件见着色器目录，作者着色器先在 shaders 里定义。`)
        else if (component.excluded || component.usesPointer) issues.push(`组件 ${layer.type} 不能用在剪辑里（${component.usesPointer ? '跟随鼠标交互' : component.excluded === 'history' ? '依赖上一帧状态，无法任意寻帧' : '依赖网页或外部素材'}）。`)
        else {
          const known = new Set(component.props.map(prop => prop.key))
          const unknown = Object.keys(layer.props ?? {}).filter(key => !known.has(key) && !(SHADER_GRAPH_UNIVERSAL_PROPS as readonly string[]).includes(key))
          if (unknown.length) issues.push(`${layer.type} 没有属性 ${unknown.join('、')}；可用属性：${component.props.map(prop => prop.key).join(', ')}。`)
        }
      }
      // 渲染在没有页面的 Worker 里、导出要可重现：属性里不收网址（图片素材走宿主输入）。
      const urls: string[] = []
      const scan = (value: unknown, path: string): void => {
        if (typeof value === 'string' && /^(https?|data|blob|file):/i.test(value.trim())) urls.push(path)
        else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) scan(item, `${path}.${key}`)
      }
      scan(layer.props ?? {}, layer.id ?? layer.type)
      if (urls.length) issues.push(`着色器图层属性不能引用网址：${urls.join('、')}。`)
      const mask = layer.props?.maskSource
      if (mask !== undefined && typeof mask !== 'string') issues.push(`图层 ${layer.id ?? layer.type} 的 maskSource 需要另一个图层的 id。`)
      visit(layer.children ?? [])
    }
  }
  visit(spec.layers)
  const masks: string[] = []
  const collect = (layers: readonly ShaderGraphLayer[]): void => { for (const layer of layers) { if (typeof layer.props?.maskSource === 'string') masks.push(layer.props.maskSource); collect(layer.children ?? []) } }
  collect(spec.layers)
  for (const mask of masks) if (!ids.has(mask)) issues.push(`遮罩引用的图层 ${mask} 不存在（给遮罩图层写上 id）。`)
  return issues
}

/** 会话缓存键：图层树结构、类型、id 与作者源码；不含属性数值。 */
export function shaderGraphStructureKey(spec: ShaderGraphSpec): string {
  const shape = (layers: readonly ShaderGraphLayer[]): unknown => layers.map(layer => [layer.type, layer.id ?? null, shape(layer.children ?? [])])
  return JSON.stringify([shape(spec.layers), (spec.shaders ?? []).map(shader => [shader.name, shader.kind, shader.wgsl, shader.speedProp ?? null, Object.entries(shader.props ?? {}).map(([key, prop]) => [key, shaderGraphCustomPropKind(prop)])])])
}
