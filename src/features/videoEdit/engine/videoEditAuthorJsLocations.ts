import { parse } from 'acorn'
import type { CodeAuthorSourceLocations } from '@/core/videoEdit/codeAuthorProgram'
import type { CodeMaterialFiles } from '@/core/videoEdit/codeMaterial/sources'
import type { CodeSourceSpan } from '@/core/videoEdit/codeMaterial/contract'

interface Node { type: string; start: number; end: number; [key: string]: unknown }
const node = (value: unknown): value is Node => !!value && typeof value === 'object' && typeof (value as Node).type === 'string' && typeof (value as Node).start === 'number'
const name = (value: unknown): string | undefined => node(value) ? value.type === 'Identifier' && typeof value.name === 'string' ? value.name : value.type === 'Literal' && typeof value.value === 'string' ? value.value : undefined : undefined

/** 轻量语法树仅用于源码导航，不执行作者代码，也不把解析失败作为加载门禁。 */
export function authorJsLocations(input: CodeMaterialFiles): CodeAuthorSourceLocations {
  const layers: Record<string, CodeSourceSpan> = Object.create(null)
  const factories: Record<string, Record<string, CodeSourceSpan>> = Object.create(null)
  const duplicates = new Set<string>()
  let fallback: CodeSourceSpan | undefined
  for (const [file, text] of Object.entries(input.files)) {
    if (!/\.[cm]?js$/.test(file)) continue
    let root: Node
    try { root = parse(text, { ecmaVersion: 'latest', sourceType: 'module' }) as unknown as Node }
    catch { continue }
    const starts = [0]
    for (let index = 0; index < text.length; index++) if (text[index] === '\n') starts.push(index + 1)
    const position = (offset: number): [number, number] => {
      let low = 0; let high = starts.length
      while (low + 1 < high) { const middle = (low + high) >>> 1; if (starts[middle] <= offset) low = middle; else high = middle }
      return [low + 1, offset - starts[low] + 1]
    }
    const span = (value: Node): CodeSourceSpan => {
      const [startLine, startColumn] = position(value.start); const [endLine, endColumn] = position(value.end)
      return { file, start: value.start, end: value.end, startLine, startColumn, endLine, endColumn }
    }
    const functions: Record<string, CodeSourceSpan> = Object.create(null)
    const repeated = new Set<string>()
    const visit = (value: Node, parent?: Node): void => {
      const functionName = value.type === 'FunctionDeclaration' ? name(value.id) : value.type === 'VariableDeclarator' && node(value.init) && ['ArrowFunctionExpression', 'FunctionExpression'].includes(value.init.type) ? name(value.id) : undefined
      if (functionName) { if (Object.hasOwn(functions, functionName)) repeated.add(functionName); else functions[functionName] = span(parent?.type === 'ExportNamedDeclaration' ? parent : value) }
      if (value.type === 'ObjectExpression' && Array.isArray(value.properties)) {
        const properties = value.properties.filter(node)
        const key = (property: Node): string | undefined => property.computed ? undefined : name(property.key)
        const id = properties.find(property => key(property) === 'id')
        const layerId = id && node(id.value) && id.value.type === 'Literal' ? name(id.value) : undefined
        if (layerId && properties.some(property => key(property) === 'draw')) {
          if (Object.hasOwn(layers, layerId)) duplicates.add(layerId)
          else layers[layerId] = span(value)
        }
        if (file === input.entry && !fallback && properties.some(property => ['layers', 'draw', 'createWebGL', 'createWebGPU'].includes(key(property) ?? ''))) fallback = span(value)
      }
      for (const child of Object.values(value)) {
        if (node(child)) visit(child, value)
        else if (Array.isArray(child)) for (const item of child) if (node(item)) visit(item, value)
      }
    }
    visit(root)
    for (const key of repeated) delete functions[key]
    if (Object.keys(functions).length) factories[file] = functions
  }
  for (const key of duplicates) delete layers[key]
  return { layers, factories, ...(fallback ? { fallback } : {}) }
}
