import { CodeMaterialError } from './contract'
import type { CodeExpression, CodeMaterialProgram } from './contract'

export const CODE_FILTER_FRAME_SLOTS = 512
/** A closed-IR dependency check; u/v, samples and repeat locals stay on GPU. */
export function codeExpressionIsFrameOnly(program: CodeMaterialProgram, value: CodeExpression, locals: ReadonlySet<number> = new Set()): boolean {
  if (value.kind === 'binding') return codeExpressionIsFrameOnly(program, program.bindings[value.slot].expression, locals)
  if (value.kind === 'context') return value.key !== 'u' && value.key !== 'v'
  if (value.kind === 'local') return locals.has(value.slot)
  if (value.kind === 'repeat') return codeExpressionIsFrameOnly(program, value.count, locals) && codeExpressionIsFrameOnly(program, value.body, new Set([...locals, value.slot]))
  if (['draw', 'draws', 'textAnimation'].includes(value.kind)) return false
  if ((value.kind === 'call' || value.kind === 'v3call') && ['sample', 'sampleOffset', 'blur', 'glow', 'shaderFilter'].includes(value.op)) return false
  return codeExpressionChildren(value).every(child => codeExpressionIsFrameOnly(program, child, locals))
}
export function codeExpressionChildren(value: CodeExpression): CodeExpression[] {
  const children: CodeExpression[] = []
  for (const item of Object.values(value)) {
    if (Array.isArray(item)) { for (const child of item) { if (child && typeof child === 'object' && 'kind' in child) children.push(child as CodeExpression) } }
    else if (item && typeof item === 'object' && 'kind' in item) children.push(item as CodeExpression)
  }
  if (value.kind === 'object' || value.kind === 'draw') children.push(...Object.values(value.properties))
  return children
}
export function codeLiftFrameExpression(program: CodeMaterialProgram, value: CodeExpression): boolean {
  return program.languageVersion === 3 && ['number', 'color', 'boolean'].includes(value.type) && !['literal', 'local'].includes(value.kind) && !(value.kind === 'color' && value.values.every(item => item.kind === 'literal')) && codeExpressionIsFrameOnly(program, value)
}
const cache = new WeakMap<CodeMaterialProgram, readonly CodeExpression[]>()
export function codeFilterFrameExpressions(program: CodeMaterialProgram): readonly CodeExpression[] {
  const cached = cache.get(program); if (cached) return cached
  const values: CodeExpression[] = []; const seen = new Set<CodeExpression>()
  const visit = (value: CodeExpression): void => {
    if (seen.has(value)) return; seen.add(value)
    if (codeLiftFrameExpression(program, value)) { values.push(value); return }
    if (value.kind === 'v3call' && value.op === 'shaderFilter') return
    codeExpressionChildren(value).forEach(visit)
  }
  program.bindings.forEach(binding => visit(binding.expression)); visit(program.result)
  if (values.length > CODE_FILTER_FRAME_SLOTS) throw new CodeMaterialError('BUDGET', `滤镜帧级 uniform 超过 ${CODE_FILTER_FRAME_SLOTS} 个 vec4 槽。`)
  cache.set(program, values); return values
}
