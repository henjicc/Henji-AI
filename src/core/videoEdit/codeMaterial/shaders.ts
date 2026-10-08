/**
 * 作者语言 v3 的着色器：`shader()` 图层与滤镜里的 `shaderFilter()`，都编译成着色器图（`shaderGraph/spec.ts`）。
 *
 * - 名称是 `shaders` 框架的组件名（Aurora、Blur、LinearWipe……），或本素材 `shaders` 里自己写的着色器；
 * - `layers` 写完整图层树（与框架预设 JSON 相同），属性值可用参数、时间与数学表达式，每帧求值；
 * - 作者 WGSL 是数据：不在 CPU 上执行，GPU 编译失败的报错带作者行号交回。
 */
import { SHADER_COMPONENTS, SHADER_GRAPH_INPUT, SHADER_GRAPH_UNIVERSAL_PROPS, shaderComponent, shaderGraphCustomPropKind, type ShaderGraphCustomShader, type ShaderGraphLayer, type ShaderGraphSpec } from '../shaderGraph/spec'
import { CODE_V3_LIMITS, CodeMaterialError, codeColor } from './contract'
import type { CodeColor, CodeExpression, CodeMaterialProgram } from './contract'

export type CodeShaderRole = 'layer' | 'filter'
const UNIVERSAL = new Set<string>(SHADER_GRAPH_UNIVERSAL_PROPS)

/** 名称是否可用；可用时返回该名称的已知属性（框架组件的属性表或作者着色器声明的属性）。 */
export function codeShaderNameIssue(program: Pick<CodeMaterialProgram, 'shaders'>, name: unknown, role: CodeShaderRole): string | undefined {
  if (typeof name !== 'string' || !name) return '着色器 name 必须是编译期确定的组件名或本素材 shaders 里的名称。'
  const custom = program.shaders?.find(shader => shader.name === name)
  if (custom) {
    if (role === 'filter' && custom.kind !== 'filter') return `着色器 ${name} 是生成器（kind:"generator"），shaderFilter 需要 kind:"filter"。`
    if (role === 'layer' && custom.kind === 'filter') return `着色器 ${name} 是滤镜（kind:"filter"），需要输入画面：用 layers 放在生成器后面，或在滤镜素材里用 shaderFilter。`
    return undefined
  }
  const component = shaderComponent(name)
  if (!component) {
    const own = program.shaders?.map(shader => shader.name) ?? []
    return `未知着色器 ${name}。可用：本素材 shaders 里的 ${own.length ? own.join(', ') : '（未定义）'}；或框架组件名（如 ${SHADER_COMPONENTS.filter(value => role === 'filter' ? value.role === 'filter' : value.role === 'generator').slice(0, 12).map(value => value.name).join(', ')} 等），完整目录读 video_edit.builtin_effect 里 shaders.* 项。`
  }
  if (role === 'filter' && component.role !== 'filter') return `${name} 不是滤镜组件，shaderFilter 只能用处理输入画面的组件（${component.role === 'transition' ? '转场组件请用 layers 写成 @input 子图层' : '生成器请用 shader 图层'}）。`
  if (role === 'layer' && component.role === 'filter') return `${name} 是滤镜组件，需要输入画面：用 layers 写成 [{type:"某个生成器"},{type:"${name}"}]，或在滤镜素材里用 shaderFilter。`
  return undefined
}
/** 图层树里的一层：只要组件或作者着色器存在即可（滤镜作用于它之前画好的兄弟图层）。 */
export function codeShaderTypeIssue(program: Pick<CodeMaterialProgram, 'shaders'>, type: string): string | undefined {
  if (program.shaders?.some(shader => shader.name === type) || shaderComponent(type)) return undefined
  return codeShaderNameIssue(program, type, 'layer') ?? `未知组件 ${type}。`
}
export function codeShaderKnownProps(program: Pick<CodeMaterialProgram, 'shaders'>, name: string): readonly string[] | undefined {
  const custom = program.shaders?.find(shader => shader.name === name)
  if (custom) return Object.keys(custom.props ?? {})
  return shaderComponent(name)?.props.map(prop => prop.key)
}
/** 属性名可写组件原名（colorA）或剪辑参数的下划线写法（color_a）。 */
export function codeShaderPropKey(program: Pick<CodeMaterialProgram, 'shaders'>, name: string, key: string): string {
  const known = codeShaderKnownProps(program, name)
  if (!known || known.includes(key) || UNIVERSAL.has(key)) return key
  const camel = key.replace(/_([a-z0-9])/g, (_, letter: string) => letter.toUpperCase())
  return known.includes(camel) || UNIVERSAL.has(camel) ? camel : key
}
export function codeShaderPropIssue(program: Pick<CodeMaterialProgram, 'shaders'>, name: string, key: string): string | undefined {
  const known = codeShaderKnownProps(program, name)
  const resolved = codeShaderPropKey(program, name, key)
  if (!known || known.includes(resolved) || UNIVERSAL.has(resolved)) return undefined
  return `${name} 没有属性 ${key}；可用属性：${[...known, ...UNIVERSAL].join(', ')}。`
}

const hex = (value: number): string => Math.round(Math.min(1, Math.max(0, value)) * 255).toString(16).padStart(2, '0')
/** 作者颜色（0–1 RGBA）→ 框架颜色字符串。 */
export function codeShaderColor(value: unknown, label: string): string {
  if (typeof value === 'string') return value
  const color: CodeColor = codeColor(value, label)
  return `#${color.map(hex).join('')}`
}
type Kind = 'color' | 'position' | 'other'
function propKind(program: Pick<CodeMaterialProgram, 'shaders'>, type: string, key: string): Kind {
  const custom = program.shaders?.find(shader => shader.name === type)?.props?.[key]
  if (custom) { const kind = shaderGraphCustomPropKind(custom); return kind === 'color' ? 'color' : kind === 'position' ? 'position' : 'other' }
  const ui = shaderComponent(type)?.props.find(prop => prop.key === key)?.ui
  return ui === 'color' ? 'color' : ui === 'position' ? 'position' : 'other'
}
/** 求值后的作者值 → 框架属性值：颜色转字符串，位置可写 {x,y} 或 [x,y]，结构化属性里的颜色数组一并转换。 */
function frameworkValue(value: unknown, kind: Kind, label: string): unknown {
  if (kind === 'color') return codeShaderColor(value, label)
  if (kind === 'position' && Array.isArray(value) && value.length === 2) return { x: value[0], y: value[1] }
  if (Array.isArray(value)) return value.map((item, index) => frameworkValue(item, 'other', `${label}[${index}]`))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'color' && Array.isArray(item) ? codeShaderColor(item, `${label}.${key}`) : frameworkValue(item, 'other', `${label}.${key}`)]))
  if (typeof value === 'number' && !Number.isFinite(value)) throw new CodeMaterialError('NON_FINITE', `${label} 必须是有限数值。`)
  return value
}
function props(program: Pick<CodeMaterialProgram, 'shaders'>, type: string, raw: unknown, label: string): Record<string, unknown> {
  if (raw === undefined) return {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new CodeMaterialError('PARAMETERS', `${label} 需要属性对象。`)
  return Object.fromEntries(Object.entries(raw).map(([written, value]) => {
    const issue = codeShaderPropIssue(program, type, written)
    if (issue) throw new CodeMaterialError('PARAMETERS', issue)
    const key = codeShaderPropKey(program, type, written)
    return [key, frameworkValue(value, propKind(program, type, key), `${type}.${key}`)]
  }))
}
function layers(program: Pick<CodeMaterialProgram, 'shaders'>, raw: unknown, label: string): ShaderGraphLayer[] {
  if (!Array.isArray(raw) || !raw.length) throw new CodeMaterialError('PARAMETERS', `${label} 需要非空图层数组。`)
  return raw.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new CodeMaterialError('PARAMETERS', `${label}[${index}] 需要 {type, props?, id?, children?} 图层对象。`)
    const layer = item as Record<string, unknown>
    const extra = Object.keys(layer).filter(key => !['type', 'id', 'props', 'children'].includes(key))
    if (extra.length) throw new CodeMaterialError('PARAMETERS', `${label}[${index}] 不认识字段 ${extra.join('、')}；图层只有 type、id、props、children。`)
    if (typeof layer.type !== 'string') throw new CodeMaterialError('PARAMETERS', `${label}[${index}].type 需要组件名。`)
    const issue = layer.type === SHADER_GRAPH_INPUT ? undefined : codeShaderTypeIssue(program, layer.type)
    if (issue) throw new CodeMaterialError('PARAMETERS', issue)
    return {
      type: layer.type,
      ...(layer.id !== undefined ? { id: String(layer.id) } : {}),
      ...(layer.props !== undefined ? { props: props(program, layer.type, layer.props, `${label}[${index}].props`) } : {}),
      ...(layer.children !== undefined ? { children: layers(program, layer.children, `${label}[${index}].children`) } : {}),
    }
  })
}
/** 图里实际用到的作者着色器（只编译用到的）。 */
function used(program: Pick<CodeMaterialProgram, 'shaders'>, graph: readonly ShaderGraphLayer[]): ShaderGraphCustomShader[] {
  const names = new Set<string>()
  const visit = (items: readonly ShaderGraphLayer[]): void => { for (const item of items) { names.add(item.type); visit(item.children ?? []) } }
  visit(graph)
  return (program.shaders ?? []).filter(shader => names.has(shader.name))
}
/**
 * 一个 shader 图层或一道 shaderFilter 的着色器图。`name` 形式只有一个组件（图层 id 为 `fx`）；
 * `layers` 形式是完整图层树。滤镜里没写 `@input` 时自动把输入画面放在最下面。
 */
export function codeShaderGraph(program: Pick<CodeMaterialProgram, 'shaders'>, value: { name?: unknown; params?: unknown; layers?: unknown }, role: CodeShaderRole): ShaderGraphSpec {
  let graph: ShaderGraphLayer[]
  if (value.layers !== undefined) graph = layers(program, value.layers, 'layers')
  else {
    const issue = codeShaderNameIssue(program, value.name, role)
    if (issue) throw new CodeMaterialError('PARAMETERS', issue)
    graph = [{ type: value.name as string, id: 'fx', props: props(program, value.name as string, value.params, `${String(value.name)}.params`) }]
  }
  const hasInput = (items: readonly ShaderGraphLayer[]): boolean => items.some(item => item.type === SHADER_GRAPH_INPUT || hasInput(item.children ?? []))
  if (role === 'filter' && !hasInput(graph)) graph = [{ type: SHADER_GRAPH_INPUT }, ...graph]
  if (role === 'layer' && hasInput(graph)) throw new CodeMaterialError('PARAMETERS', '@input 只能用在滤镜（shaderFilter）里；生成器没有输入画面。')
  const shaders = used(program, graph)
  return { layers: graph, ...(shaders.length ? { shaders } : {}) }
}

/** 着色器时间（秒）：可慢放、倒放、循环，不累积历史。 */
export function codeShaderTime(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e7) throw new CodeMaterialError('NON_FINITE', '着色器 time 必须是绝对值不超过 1e7 秒的有限数值。')
  return value
}
export function unwrapCodeShaderExpression(program: CodeMaterialProgram, value: CodeExpression): CodeExpression {
  return value.kind === 'binding' ? unwrapCodeShaderExpression(program, program.bindings[value.slot].expression) : value
}
/** Undefined means a frame expression; literal/alias values are checked before reaching GPU preparation. */
export function staticCodeShaderValue(program: CodeMaterialProgram, value: CodeExpression): unknown {
  const raw = unwrapCodeShaderExpression(program, value)
  if (raw.kind === 'literal') return raw.value
  if (raw.kind === 'unary' && raw.op !== '!') { const v = staticCodeShaderValue(program, raw.value); return typeof v === 'number' ? (raw.op === '-' ? -v : v) : undefined }
  if (raw.kind === 'color' || raw.kind === 'array') { const values = raw.values.map(value => staticCodeShaderValue(program, value)); return values.every(value => value !== undefined) ? values : undefined }
  return undefined
}
/** `shaderFilter` 第一个参数：组件或作者滤镜的名字（字符串），或 `{layers:[...]}` 图层树。 */
export interface CodeShaderFilterPass { expression: Extract<CodeExpression, { kind: 'v3call' }>; name?: string; target: CodeExpression; params?: CodeExpression; input?: number }
/** A closed acyclic texture graph. Same call reused through const/helper aliases is rendered once. */
export function codeShaderFilterPasses(program: CodeMaterialProgram): CodeShaderFilterPass[] {
  const passes: CodeShaderFilterPass[] = []; const visited = new Set<CodeExpression>()
  const visit = (value: CodeExpression): void => {
    value = unwrapCodeShaderExpression(program, value)
    if (visited.has(value)) return
    visited.add(value)
    if (value.kind === 'v3call' && value.op === 'shaderFilter') {
      const target = unwrapCodeShaderExpression(program, value.args[0])
      const name = staticCodeShaderValue(program, target)
      if (target.kind !== 'object') { const issue = codeShaderNameIssue(program, name, 'filter'); if (issue) throw new CodeMaterialError('PARAMETERS', issue, value.sourceSpan) }
      const tree = target.kind === 'object'
      let input: number | undefined
      const chained = value.args[tree ? 1 : 2]
      if (chained) {
        const from = unwrapCodeShaderExpression(program, chained)
        if (from.kind !== 'v3call' || from.op !== 'shaderFilter') throw new CodeMaterialError('TYPE', 'shaderFilter 的输入只能是另一项 shaderFilter；像素色彩运算放在最终返回表达式。', value.sourceSpan)
        visit(from); input = passes.findIndex(pass => pass.expression === from)
      }
      passes.push({ expression: value, ...(tree ? {} : { name: name as string, params: value.args[1] }), target, input })
      if (passes.length > CODE_V3_LIMITS.shaderFilterPasses) throw new CodeMaterialError('BUDGET', `每帧最多 ${CODE_V3_LIMITS.shaderFilterPasses} 道着色器滤镜工序。`, value.sourceSpan)
      return
    }
    for (const item of Object.values(value)) {
      if (Array.isArray(item)) item.forEach(child => { if (child && typeof child === 'object' && 'kind' in child) visit(child as CodeExpression) })
      else if (item && typeof item === 'object' && 'kind' in item) visit(item as CodeExpression)
    }
    if (value.kind === 'object') Object.values(value.properties).forEach(visit)
  }
  program.bindings.forEach(binding => visit(binding.expression)); visit(program.result)
  return passes
}
