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

it('imports raw shader files as text and preserves ordinary async JS metadata', async () => {
  const shader = '@compute @workgroup_size(8,8) fn main() {}'
  const bundle = await bundleAuthorFiles({ entry: 'main.js', files: {
    'main.js': 'import source from "./effect.wgsl"; const names=await Promise.resolve(["原始","着色器"]); export default {name:names.join(""),createWebGPU(device){return {draw(){device.createShaderModule({code:source})}}}};',
    'effect.wgsl': shader,
  } }, build)
  expect(bundle.code).toContain(shader)
  expect(bundle.code).toContain('await Promise.resolve')
  expect(bundle.code).toContain('device.createShaderModule')
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

it('内置库保持外部依赖并改写成共享模块地址，记录所用版本', async () => {
  const bundle = await bundleAuthorFiles({ entry: 'main.js', apiVersion: 5, files: {
    'main.js': 'import * as THREE from "three"; import { WebGPURenderer } from "three/webgpu"; import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"; export const font = () => import("opentype.js"); export default { draw() { return [THREE, WebGPURenderer, GLTFLoader] } };',
  } }, build)
  expect(bundle.code).toContain('from "henji-media://author-lib/three/0.186.1/build/three.module.js"')
  expect(bundle.code).toContain('from "henji-media://author-lib/three/0.186.1/build/three.webgpu.js"')
  expect(bundle.code).toContain('from "henji-media://author-lib/three/0.186.1/examples/jsm/loaders/GLTFLoader.js"')
  expect(bundle.code).toContain('import("henji-media://author-lib/opentype.js/2.0.0/opentype.mjs")')
  expect(bundle.libraries).toEqual({ three: '0.186.1', 'opentype.js': '2.0.0' })
})

it('项目里的同名文件优先于内置库；未登记的裸名列出可用的内置库', async () => {
  const own = await bundleAuthorFiles({ entry: 'main.js', files: { 'main.js': 'import { v } from "three"; export default { draw() { return v } };', 'three.js': 'export const v = "vendored";' } }, build)
  expect(own.code).toContain('"vendored"')
  expect(own.libraries).toBeUndefined()
  await expect(bundleAuthorFiles({ entry: 'main.js', files: { 'main.js': 'import _ from "lodash"; export default _;' } }, build)).rejects.toThrow(/找不到模块 lodash（由 main\.js 导入）。可用的内置库：three@0\.186\.1.*opentype\.js@2\.0\.0/)
  await expect(bundleAuthorFiles({ entry: 'main.js', files: { 'main.js': 'import * as T from "three"; export default T;' }, libraries: { three: '0.999.0' } }, build)).rejects.toThrow('找不到模块 three')
})

it('TS 路径的运行时 import(名字) 与 JS 直出用同一张内置库表，并带上编译输入的作者接口版本', async () => {
  const bundle = await bundleAuthorFiles({ entry: 'main.ts', apiVersion: 5, files: { 'main.ts': 'export const load = (name: string) => import(name); export default { name: "x", draw() {} };' } }, build)
  expect(bundle.apiVersion).toBe(5)
  const call = /import\((\(\(s\)=>\{[\s\S]*?return s;\}\))\(name\)\)/.exec(bundle.code)
  expect(call, bundle.code).not.toBeNull()
  const resolve = new Function(`return ${call![1]}`)() as (specifier: string) => string
  expect(resolve('three/webgpu')).toBe('henji-media://author-lib/three/0.186.1/build/three.webgpu.js')
  expect(decodeURIComponent(resolve('lodash'))).toContain('找不到模块 lodash（由 main.ts 导入）。可用的内置库：three@0.186.1')
})

it('TS 路径同样报出同名项目文件遮住内置库', async () => {
  await expect(bundleAuthorFiles({ entry: 'main.ts', files: { 'main.ts': 'import T from "./three"; export default T;', 'three.ts': 'import * as T from "three"; export default T;' } }, build)).rejects.toThrow('three.ts 导入 three 时解析到了它自己')
})

it('作者接口 v4 的源码导入内置库时明确拒绝，不静默放行一个记录不了版本的导入', async () => {
  await expect(bundleAuthorFiles({ entry: 'main.ts', files: { 'main.ts': 'import * as T from "three"; export default T;' } }, build)).rejects.toThrow(/three@.*从作者接口 v5 起可用.*作者接口 v4/)
  const runtime = await bundleAuthorFiles({ entry: 'main.ts', apiVersion: 4, files: { 'main.ts': 'export const load = (name: string) => import(name); export default { name: "x", draw() {} };' } }, build)
  const call = /import\((\(\(s\)=>\{[\s\S]*?return s;\}\))\(name\)\)/.exec(runtime.code)
  const resolve = new Function(`return ${call![1]}`)() as (specifier: string) => string
  expect(decodeURIComponent(resolve('three/webgpu'))).toMatch(/three@.*从作者接口 v5 起可用/)
  expect(decodeURIComponent(resolve('lodash'))).toContain('找不到模块 lodash')
})

it('TS 打包与原生模块路径使用相同的排版库 v6 门槛', async () => {
  for (const source of ['import { layoutText } from "henji-layout/text"; export default { name: "标题", draw() { return layoutText("a", {}); } };', 'export const load = () => import("henji-layout/flex"); export default { name: "标题", draw() {} };']) {
    const files = { entry: 'main.ts', files: { 'main.ts': source } }
    await expect(bundleAuthorFiles({ ...files, apiVersion: 5 }, build)).rejects.toThrow(/作者接口 v6/)
    const result = await bundleAuthorFiles({ ...files, apiVersion: 6 }, build)
    expect(result.code).toContain('henji-media://author-lib/henji-layout/1.0.0/')
    expect(result.libraries).toEqual({ 'henji-layout': '1.0.0' })
  }
})
