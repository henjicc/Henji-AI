import { CodeMaterialError } from './contract'
import type { CodeExpression, CodeMaterialProgram, CodeParameterDeclaration, CodeParameterValues } from './contract'

export const CODE_FILTER_PARAMETER_SLOTS = 64
export const CODE_FILTER_UNIFORM_VEC4S = CODE_FILTER_PARAMETER_SLOTS + 3
export interface CodeFilterParameterReference { key: string; field?: string; parameter: CodeParameterDeclaration; projection: string[] }
export interface CodeFilterParameterSlot { key: string; field?: string; parameter: CodeParameterDeclaration; index: number }
export function codeFilterParameterReference(program: CodeMaterialProgram, input: CodeExpression): CodeFilterParameterReference | undefined {
  const path: string[] = []; let value = input
  while (value.kind === 'binding' || value.kind === 'field') {
    if (value.kind === 'binding') value = program.bindings[value.slot].expression
    else { path.unshift(value.key); value = value.value }
  }
  if (value.kind !== 'parameter') return undefined
  let parameter = program.parameters.find(parameter => parameter.key === value.key)
  if (!parameter) throw new CodeMaterialError('PARAMETERS', `未声明滤镜参数：${value.key}`)
  let field: string | undefined
  if (parameter.type === 'custom' && path.length) {
    field = path.shift()!; parameter = parameter.fields[field]
    if (!parameter) throw new CodeMaterialError('TYPE', `自定义参数 ${value.key} 不存在字段 ${field}。`)
  }
  return { key: value.key, field, parameter, projection: path }
}
export function codeFilterParameterSlotId(key: string, field?: string): string { return `${key}:${field ?? ''}` }
/** Only pixel reads occupy uniform slots. shaderFilter properties are CPU/frame expressions. */
export function codeFilterParameterSlots(program: CodeMaterialProgram): CodeFilterParameterSlot[] {
  const slots = new Map<string, CodeFilterParameterSlot>(); const visited = new Set<CodeExpression>()
  const add = (key: string, parameter: CodeParameterDeclaration, field?: string): void => {
    if (parameter.type === 'custom') { Object.entries(parameter.fields).forEach(([name, member]) => add(key, member, name)); return }
    if (!['number', 'angle', 'seed', 'boolean', 'color', 'point', 'range', 'grade'].includes(parameter.type) || parameter.type === 'point' && parameter.space !== 'frame') throw new CodeMaterialError('TYPE', `参数 ${key}${field ? '.' + field : ''}（${parameter.type}）不能用于逐像素 GPU 表达式；choice/text/font/easing 可在 shaderFilter 的帧级属性表达式使用，gradient/curve 请在帧级用 sampleGradient/sampleCurve 或改用自写 WGSL / shader 组件；point 仅支持 frame 空间。`)
    const id = codeFilterParameterSlotId(key, field)
    if (!slots.has(id)) slots.set(id, { key, field, parameter, index: slots.size })
    if (slots.size > CODE_FILTER_PARAMETER_SLOTS) throw new CodeMaterialError('BUDGET', `逐像素滤镜读取的参数/结构字段需要 ${slots.size} 个 vec4 槽位，超过 GPU 统一缓冲的 ${CODE_FILTER_PARAMETER_SLOTS} 槽技术限制；请减少逐像素读取，或将计算放进 shaderFilter 帧级属性。声明参数数量不受此限制。`)
  }
  const visit = (value: CodeExpression): void => {
    if (visited.has(value)) return
    visited.add(value)
    if (value.kind === 'v3call' && value.op === 'shaderFilter') return
    if (value.kind === 'v3call' && ['sampleGradient', 'sampleCurve', 'ease'].includes(value.op)) throw new CodeMaterialError('TYPE', `${value.op} 仅在 CPU 帧级表达式可用，不能用于逐像素 GPU 表达式；请放入 shaderFilter 属性，或使用自写 WGSL / shader 组件。`, value.sourceSpan)
    const reference = codeFilterParameterReference(program, value)
    if (reference) { add(reference.key, reference.parameter, reference.field); return }
    if (value.kind === 'binding') { visit(program.bindings[value.slot].expression); return }
    if (value.kind === 'field' && value.value.kind === 'object' && value.value.properties[value.key]) { visit(value.value.properties[value.key]); return }
    for (const item of Object.values(value)) {
      if (Array.isArray(item)) item.forEach(child => { if (child && typeof child === 'object' && 'kind' in child) visit(child as CodeExpression) })
      else if (item && typeof item === 'object' && 'kind' in item) visit(item as CodeExpression)
    }
    if (value.kind === 'object') Object.values(value.properties).forEach(visit)
  }
  visit(program.result)
  return [...slots.values()]
}
/** Shared layout for the WGSL emitter and upload path, including flattened custom fields. */
export function packCodeFilterParameters(program: CodeMaterialProgram, values: CodeParameterValues): Float32Array {
  const packed = new Float32Array(CODE_FILTER_PARAMETER_SLOTS * 4)
  for (const slot of codeFilterParameterSlots(program)) {
    const value = slot.field ? (values[slot.key] as Record<string, unknown>)[slot.field] : values[slot.key]
    const offset = slot.index * 4
    if (typeof value === 'number' || typeof value === 'boolean') packed[offset] = Number(value)
    else if (Array.isArray(value)) packed.set(value as number[], offset)
    else if (slot.parameter.type === 'point') { const p = value as { x: number; y: number }; packed.set([p.x, p.y], offset) }
    else if (slot.parameter.type === 'grade') { const p = value as { hue: number; strength: number; luminance: number }; packed.set([p.hue, p.strength, p.luminance], offset) }
    else throw new CodeMaterialError('PARAMETERS', `滤镜参数 ${slot.key} 的 GPU 值形状无效。`)
  }
  return packed
}
