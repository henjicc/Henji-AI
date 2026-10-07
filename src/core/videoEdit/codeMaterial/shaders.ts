import { SHADER_EFFECT_DEFINITIONS, type ShaderLibraryDefinition } from '../shaderLibrary/catalog'
import { CODE_V3_LIMITS, CodeMaterialError, codeColor } from './contract'
import type { CodeExpression, CodeMaterialProgram } from './contract'

/** Author names are derived from the trusted catalog; never a second effect registry. */
export function listCodeShaders(role?: 'background' | 'filter'): { name: string; definition: ShaderLibraryDefinition }[] {
  return SHADER_EFFECT_DEFINITIONS.filter(value => !role || value.role === role).map(definition => ({ name: definition.id.slice('shader_'.length), definition }))
}
export function codeShaderDefinition(name: unknown, role: 'background' | 'filter'): ShaderLibraryDefinition {
  const found = listCodeShaders(role).find(value => value.name === name)
  if (!found) throw new CodeMaterialError('PARAMETERS', `未知${role === 'background' ? '生成' : '滤镜'}着色器 ${String(name)}；可用名称：${listCodeShaders(role).map(value => value.name).join(', ')}。`)
  return found.definition
}
export function codeShaderParameter(definition: ShaderLibraryDefinition, key: string, value: unknown): number | string {
  const param = definition.params.find(value => value.key === key)
  const label = `${definition.id.slice(7)}.${key}`
  if (!param) throw new CodeMaterialError('PARAMETERS', `${label} 未知；可用参数：${definition.params.map(value => value.key).join(', ')}。`)
  if (param.type === 'number' && typeof value === 'number' && Number.isFinite(value) && value >= param.min && value <= param.max) return value
  // t66's colors are RGB, opaque backgrounds. Layer transparency is expressed with opacity.
  if (param.type === 'color') return '#' + codeColor(value, label).slice(0, 3).map(value => Math.round(value * 255).toString(16).padStart(2, '0')).join('')
  throw new CodeMaterialError('PARAMETERS', `${label} 需要${param.type === 'number' ? `有限数字 ${param.min}–${param.max}` : param.type}。`)
}
export function codeShaderParams(name: unknown, role: 'background' | 'filter', value: unknown): Record<string, number | string> {
  const definition = codeShaderDefinition(name, role)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CodeMaterialError('PARAMETERS', `${String(name)}.params 需要参数对象。`)
  const supplied = Object.fromEntries(Object.entries(value).map(([key, value]) => [key, codeShaderParameter(definition, key, value)]))
  return Object.fromEntries(definition.params.map(param => {
    const result = supplied[param.key] ?? param.default
    if (typeof result !== 'number' && typeof result !== 'string') throw new CodeMaterialError('TYPE', '着色器目录包含尚未支持的参数类型。')
    return [param.key, result]
  }))
}
/** t66 multiplies seconds by speed (up to four) before uploading f32 uniforms. */
export function codeShaderTime(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isFinite(Math.fround(value * 4))) throw new CodeMaterialError('NON_FINITE', '着色器 time 必须能在 GPU 有限数值范围内表示。')
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
export interface CodeShaderFilterPass { expression: Extract<CodeExpression, { kind: 'v3call' }>; name: string; params: CodeExpression; input?: number }
/** A closed acyclic texture graph. Same call reused through const/helper aliases is rendered once. */
export function codeShaderFilterPasses(program: CodeMaterialProgram): CodeShaderFilterPass[] {
  const passes: CodeShaderFilterPass[] = []; const visited = new Set<CodeExpression>()
  const visit = (value: CodeExpression): void => {
    value = unwrapCodeShaderExpression(program, value)
    if (visited.has(value)) return
    visited.add(value)
    if (value.kind === 'v3call' && value.op === 'shaderFilter') {
      const name = staticCodeShaderValue(program, value.args[0]); codeShaderDefinition(name, 'filter')
      let input: number | undefined
      if (value.args[2]) {
        const from = unwrapCodeShaderExpression(program, value.args[2])
        if (from.kind !== 'v3call' || from.op !== 'shaderFilter') throw new CodeMaterialError('TYPE', 'shaderFilter 第三个参数只能是另一项 shaderFilter；像素色彩运算放在最终返回表达式。', value.sourceSpan)
        visit(from); input = passes.findIndex(pass => pass.expression === from)
      }
      passes.push({ expression: value, name: name as string, params: value.args[1], input })
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
