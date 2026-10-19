import { expect, it } from 'vitest'
import { build } from 'esbuild-wasm'
import { authorSourceLocations, bundleAuthorFiles } from './videoEditAuthorBundle'

it('bundles ordinary JS, relative imports, JSON and cycles without executing author code', async () => {
  const bundle = await bundleAuthorFiles({ entry: 'main.js', files: {
    'main.js': 'import { value } from "./shared/a.js"; import data from "./data.json"; globalThis.__author_test_executed = true; export default { name: data.name, draw(ctx) { for (const v of [1,2,3].map(x=>x*value())) ctx.fillText(String(v),0,0); } };',
    'shared/a.js': 'import { b } from "./b.js"; export const a = 2; export function value() { return a + b(); }',
    'shared/b.js': 'import { a } from "./a.js"; export function b() { return a * 3; }',
    'data.json': '{"name":"原样 JS"}',
  } }, build)
  expect(bundle.code).toContain('fillText')
  expect(bundle.code).not.toContain('from "./')
  expect(Object.hasOwn(globalThis, '__author_test_executed')).toBe(false)
  expect(JSON.parse(bundle.map).sourcesContent).toContain('import { a } from "./a.js"; export function b() { return a * 3; }')
  expect(bundle.locations.fallback).toMatchObject({ file: 'main.js', startLine: 1 })
})

it('reports the missing import and original syntax location', async () => {
  await expect(bundleAuthorFiles({ entry: 'main.js', files: { 'main.js': 'import x from "./missing.js"; export default x;' } }, build)).rejects.toThrow('找不到模块 ./missing.js（由 main.js 导入）')
  try {
    await bundleAuthorFiles({ entry: 'main.js', files: { 'main.js': 'export default {\n draw( {\n' } }, build)
    throw new Error('expected syntax error')
  } catch (error) {
    expect(error).toMatchObject({ code: 'SYNTAX', sourceSpan: expect.objectContaining({ file: 'main.js', startLine: 3 }) })
  }
})

it('locates explicit layers and falls back for ambiguous IDs without evaluating factories', () => {
  const source = 'export default { layers() {\n return [{ id:"title", draw(ctx){} }, {id:"same",draw(){}}, {id:"same",draw(){}}];\n} };'
  const result = authorSourceLocations({ entry: 'main.js', files: { 'main.js': source } })
  const span = result.layers.title
  expect(source.slice(span.start, span.end)).toBe('{ id:"title", draw(ctx){} }')
  expect(result.layers.same).toBeUndefined()
  expect(result.fallback).toMatchObject({ file: 'main.js', startLine: 1, endLine: 3 })
})

it('indexes named factories once and does not guess among same-name nested functions', () => {
  const factory = 'export function node(row,index) { return {id:`node-${index}`,draw(ctx){ctx.fillText(row.title,0,0)}} }'
  const result = authorSourceLocations({ entry: 'main.js', files: {
    'main.js': 'export default {layers(){return []}}',
    'nodes.js': factory + '\nexport const tag = row => ({id:row.id, draw(){}});\nfunction duplicate(){}; function outer(){function duplicate(){}}',
  } })
  const span = result.factories!['nodes.js']
  expect(span.node.startLine).toBe(1)
  expect((factory + '\n').slice(span.node.start, span.node.end)).toBe(factory)
  expect(span.tag.startLine).toBe(2)
  expect(span.duplicate).toBeUndefined()
})
