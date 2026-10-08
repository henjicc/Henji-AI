import ts from 'typescript'
import type { CodeMaterialProgram } from './codeMaterial/contract'
import type { CodeElementBounds } from './codeMaterial/geometry'
import type { CodeElementOverride } from './codeElementOverrides'

export interface CodeElementBakeResult { source: string; merged: boolean; reason?: string }
/** Resize only the exported canvas metadata; comments, layout literals and render code remain intact. */
export function resizeCodeMaterialCanvas(source: string, size: { width: number; height: number }): string {
  if (![size.width, size.height].every(value => Number.isInteger(value) && value >= 1 && value <= 8192)) throw new Error('预览画幅尺寸无效。')
  const file = ts.createSourceFile('preview.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const exported = file.statements.at(-1)
  if (!exported || !ts.isExportAssignment(exported) || !ts.isObjectLiteralExpression(exported.expression)) throw new Error('风格组件缺少画幅定义。')
  const edits: Array<{ start: number; end: number; text: string }> = []
  for (const key of ['width', 'height'] as const) {
    const fields = exported.expression.properties.filter((property): property is ts.PropertyAssignment => ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) && property.name.text === key)
    if (fields.length !== 1) throw new Error('风格组件缺少唯一的画幅尺寸。')
    const value = fields[0].initializer
    edits.push({ start: value.getStart(file), end: value.end, text: String(size[key]) })
  }
  return edits.sort((a, b) => b.start - a.start).reduce((text, edit) => text.slice(0, edit.start) + edit.text + text.slice(edit.end), source)
}
/** Only literals at the exact selected call are changed; expressions, repeats and aliases go to the assistant. */
export function bakeCodeElementLiterals(source: string, element: CodeElementBounds, override: CodeElementOverride, sameSourceOccurrences = 1): CodeElementBakeResult {
  const fail = (reason: string): CodeElementBakeResult => ({ source, merged: false, reason })
  if (!element.sourceSpan || sameSourceOccurrences !== 1) return fail('此元素由重复或共享源码生成。')
  if (Object.keys(override.curves ?? {}).length) return fail('此元素包含关键帧。')
  if (['scale', 'scaleX', 'scaleY', 'rotation'].some(key => key in override)) return fail('此元素需要合并围绕锚点的变换。')
  const file = ts.createSourceFile('frame.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let call: ts.CallExpression | undefined
  const visit = (node: ts.Node): void => { if (ts.isCallExpression(node) && node.getStart(file) === element.sourceSpan!.start && node.end === element.sourceSpan!.end) call = node; ts.forEachChild(node, visit) }
  visit(file)
  if (!call || !ts.isObjectLiteralExpression(call.arguments[0])) return fail('源码位置已改变或属性来自表达式。')
  for (let parent: ts.Node | undefined = call.parent; parent; parent = parent.parent) {
    if (ts.isVariableDeclaration(parent) || ts.isCallExpression(parent) && ts.isIdentifier(parent.expression) && parent.expression.text === 'repeat') return fail('此元素来自可复用绑定或重复调用。')
  }
  const object = call.arguments[0]
  const properties = new Map<string, ts.PropertyAssignment>()
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property) || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) return fail('属性来自简写或展开表达式。')
    properties.set(property.name.text, property)
  }
  const number = (node: ts.Expression): number | undefined => ts.isNumericLiteral(node) ? Number(node.text) : ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand) ? node.operator === ts.SyntaxKind.MinusToken ? -Number(node.operand.text) : node.operator === ts.SyntaxKind.PlusToken ? Number(node.operand.text) : undefined : undefined
  const literal = (node: ts.Expression): boolean => number(node) !== undefined || ts.isStringLiteral(node) || node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword || ts.isArrayLiteralExpression(node) && node.elements.every(value => ts.isExpression(value) && literal(value))
  const changes = new Map<string, unknown>()
  for (const [key, value] of Object.entries(override)) {
    if (key === 'curves') continue
    if (key === 'dx' || key === 'dy') {
      if (element.command.rotation || (element.command.scaleX ?? 1) !== 1 || (element.command.scaleY ?? 1) !== 1) return fail('坐标和作者变换需要一起合并。')
      const fields = element.command.kind === 'line' ? key === 'dx' ? ['x1', 'x2'] : ['y1', 'y2'] : [key === 'dx' ? 'x' : 'y']
      for (const field of fields) { const property = properties.get(field); const previous = property && number(property.initializer); if (previous === undefined) return fail('坐标来自表达式。'); changes.set(field, previous + Number(value)) }
    } else changes.set(key === 'hidden' ? 'opacity' : key === 'fill' && properties.has('color') ? 'color' : key, key === 'hidden' ? value ? 0 : element.command.opacity ?? 1 : value)
  }
  if (!changes.size) return fail('此元素没有可合并的覆盖。')
  const edits: Array<{ start: number; end: number; text: string }> = []; const additions: string[] = []
  for (const [key, value] of changes) {
    const property = properties.get(key)
    if (property && !literal(property.initializer)) return fail(`属性 ${key} 来自表达式。`)
    if (property) edits.push({ start: property.initializer.getStart(file), end: property.initializer.end, text: JSON.stringify(value) })
    else additions.push(`${key}:${JSON.stringify(value)}`)
  }
  if (additions.length) edits.push({ start: object.end - 1, end: object.end - 1, text: `${object.properties.length && !object.properties.hasTrailingComma ? ',' : ''}${additions.join(',')}` })
  let next = source
  for (const edit of edits.sort((a, b) => b.start - a.start)) next = next.slice(0, edit.start) + edit.text + next.slice(edit.end)
  return { source: next, merged: true }
}

/** Parameter text editing targets only a direct string parameter, including a chain of local aliases. */
export function codeElementTextParameter(program: CodeMaterialProgram, sourceStart: number | undefined, sourceFile = 'main.ts'): string | undefined {
  let result: string | undefined
  const resolve = (expression: unknown, seen = new Set<number>()): string | undefined => {
    if (!expression || typeof expression !== 'object' || !('kind' in expression)) return undefined
    if (expression.kind === 'parameter' && 'key' in expression && typeof expression.key === 'string') return program.parameters.some(parameter => parameter.key === expression.key && parameter.type === 'text') ? expression.key : undefined
    if (expression.kind === 'binding' && 'slot' in expression && typeof expression.slot === 'number' && !seen.has(expression.slot)) return resolve(program.bindings[expression.slot]?.expression, new Set([...seen, expression.slot]))
    return undefined
  }
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    if ('kind' in value && value.kind === 'draw' && 'sourceSpan' in value && (value.sourceSpan as { start?: number; file?: string } | undefined)?.start === sourceStart && (value.sourceSpan as { file?: string } | undefined)?.file === sourceFile && 'properties' in value) result = resolve((value.properties as Record<string, unknown>).text)
    for (const child of Object.values(value)) if (child && typeof child === 'object') visit(child)
  }
  visit(program.result); program.bindings.forEach(binding => visit(binding.expression))
  return result
}

export function codeElementSourceIds(program: CodeMaterialProgram, existing: readonly string[]): Set<string> {
  const ids = new Set<string>(); const automatic = new Set<string>()
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    if ('kind' in value && value.kind === 'draw' && 'properties' in value) {
      const id = (value.properties as Record<string, { kind?: string; value?: unknown }>).id
      if (id?.kind === 'literal' && typeof id.value === 'string') ids.add(id.value)
      else if ('sourceSpan' in value) automatic.add(`call:${(value.sourceSpan as { file: string; start: number }).file}:${(value.sourceSpan as { start: number }).start}`)
    }
    for (const child of Object.values(value)) if (child && typeof child === 'object') visit(child)
  }
  visit(program.result); program.bindings.forEach(binding => visit(binding.expression))
  for (const id of existing) {
    const base = id.split('@[')[0]
    const call = base.match(/^(call:[^:]+:\d+)(?::\d+(?:\.\d+)*)?$/)?.[1]
    if (ids.has(base) || ids.has(base.replace(/:\d+(?:\.\d+)*$/, '')) || automatic.has(base) || call && automatic.has(call)) ids.add(id)
  }
  return ids
}
