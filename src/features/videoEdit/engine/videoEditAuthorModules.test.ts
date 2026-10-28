import { afterEach, expect, it, vi } from 'vitest'
import { createAuthorModuleUrls, directAuthorBundle, rewriteAuthorModule } from './videoEditAuthorModules'
import { VideoEditCodeCompiler } from './videoEditCodeCompiler'
import { authorJsLocations } from './videoEditAuthorJsLocations'

afterEach(() => { vi.restoreAllMocks() })

it('纯 JS 与 mjs 保留原文、多文件共用依赖，完全不创建转译线程', async () => {
  const create = vi.fn(() => { throw new Error('不应启动 esbuild') })
  const compiler = new VideoEditCodeCompiler(create)
  const files = { entry: 'main.js', files: {
    'main.js': 'import { n } from "./shared.mjs"; export { n } from "./shared.mjs"; export default {name:"测试",draw(){return n}}',
    'shared.mjs': 'export let n = 3;',
  } }
  const bundle = await compiler.bundle(files)
  expect(bundle.modules).toEqual(files)
  expect(bundle.code).toBe(files.files['main.js'])
  expect(create).not.toHaveBeenCalled()
  const blobs: Blob[] = []
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { blobs.push(blob as Blob); return `blob:test-${blobs.length}` })
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  const loaded = createAuthorModuleUrls(bundle)
  expect(blobs).toHaveLength(2)
  expect(await blobs[1].text()).toContain('from "blob:test-1"')
  expect(await blobs[0].text()).toBe(files.files['shared.mjs'])
  loaded.dispose(); loaded.dispose()
  expect(revoke).toHaveBeenCalledTimes(2)
})

it('组件映射、再导出、动态字符串导入和着色器使用同一轻量链接器', async () => {
  const bundle = directAuthorBundle({ entry: 'main.js', files: {
    'main.js': 'export { n } from "@组件/参数"; export const lazy = () => import("./shader.wgsl");',
    'component.mjs': 'export const n = 1;', 'shader.wgsl': '@fragment fn main() {}',
  }, resolvedImports: { 'main.js': { '@组件/参数': 'component.mjs' } } })!
  const blobs: Blob[] = []
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { blobs.push(blob as Blob); return `blob:test-${blobs.length}` })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  const loaded = createAuthorModuleUrls(bundle)
  const code = await blobs.at(-1)!.text()
  expect(code).toContain('import("blob:test-1")')
  expect(code).toContain('from "blob:test-2"')
  expect(await blobs[0].text()).toBe('export default "@fragment fn main() {}";')
  loaded.dispose()
})

it('含 TS 才进入兼容路径；链接失败释放已创建 URL', () => {
  expect(directAuthorBundle({ entry: 'main.ts', files: { 'main.ts': 'export const n: number = 1' } })).toBeUndefined()
  const bundle = directAuthorBundle({ entry: 'main.js', files: { 'main.js': 'import "./missing.js"; import "./ok.js";', 'ok.js': 'export const n = 1;' } })!
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:ok')
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  expect(() => createAuthorModuleUrls(bundle)).toThrow('找不到模块')
  expect(revoke).toHaveBeenCalledWith('blob:ok')
})

it('轻量 JS 导航保留元素与工厂范围，重复 ID 不误指到某个元素', () => {
  const text = 'export function title(){return {id:"title", draw(){}}}\nexport default {layers(){return [{id:"same",draw(){}},{id:"same",draw(){}}]}};'
  const locations = authorJsLocations({ entry: 'main.js', files: { 'main.js': text } })
  expect(text.slice(locations.factories!['main.js'].title.start, locations.factories!['main.js'].title.end)).toBe(text.split('\n')[0])
  expect(text.slice(locations.layers.title.start, locations.layers.title.end)).toBe('{id:"title", draw(){}}')
  expect(locations.layers.same).toBeUndefined()
  expect(locations.fallback?.startLine).toBe(1)
})

it('JSON 模块改写同时移除静态和动态导入的 JSON 属性', async () => {
  const bundle = directAuthorBundle({ entry: 'main.js', files: { 'main.js': 'import data from "./data.json" with {type:"json"}; export const read=()=>import("./data.json", {with:{type:"json"}});', 'data.json': '{"value":3}' } })!
  const blobs: Blob[] = []
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { blobs.push(blob as Blob); return `blob:test-${blobs.length}` })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  const loaded = createAuthorModuleUrls(bundle)
  expect(await blobs.at(-1)!.text()).toBe('import data from "blob:test-1"; export const read=()=>import("blob:test-1");')
  loaded.dispose()
})

it('JS 直出路径把内置库的静态、字面动态与运行时动态导入都改成共享地址', async () => {
  const bundle = directAuthorBundle({ entry: 'main.js', apiVersion: 5, files: {
    'main.js': 'import * as THREE from "three"; import { pass } from "three/tsl"; export const lazy = () => import("three/addons/math/SimplexNoise.js"); export const any = (name) => import(name); export default { draw() { return [THREE, pass] } };',
  } })!
  expect(bundle.libraries).toEqual({ three: '0.186.1' })
  const code = rewriteAuthorModule(bundle.modules!, 'main.js', path => `blob:${path}`)
  expect(code).toContain('from "henji-media://author-lib/three/0.186.1/build/three.module.js"')
  expect(code).toContain('from "henji-media://author-lib/three/0.186.1/build/three.tsl.js"')
  expect(code).toContain('import("henji-media://author-lib/three/0.186.1/examples/jsm/math/SimplexNoise.js")')
  // 运行时说明符：取出改写后的解析函数直接求值，按同一张表得到地址。
  const resolver = /import\((\(\(s\)=>\{[\s\S]*\}\))\(name\)\)/.exec(code)![1]
  const resolve = new Function(`return ${resolver}`)() as (specifier: string) => string
  expect(resolve('opentype.js')).toBe('henji-media://author-lib/opentype.js/2.0.0/opentype.mjs')
  expect(resolve('three/examples/jsm/loaders/GLTFLoader.js')).toBe('henji-media://author-lib/three/0.186.1/examples/jsm/loaders/GLTFLoader.js')
  // 越出登记目录与未登记的裸名都换成只抛错的模块：import() 照常拒绝，错误列出可用的内置库。
  for (const specifier of ['three/addons/../../build/three.cjs', 'lodash']) {
    const url = resolve(specifier)
    expect(url.startsWith('data:text/javascript,'), specifier).toBe(true)
    expect(decodeURIComponent(url)).toContain(`找不到模块 ${specifier}（由 main.js 导入）。可用的内置库：three@0.186.1`)
  }
  expect(resolve('./local.js')).toBe('./local.js')
})

it('项目根目录的同名文件导入内置库名时报出遮挡，而不是静默导入自己', () => {
  const files = { entry: 'main.js', files: { 'main.js': 'import "./three.js";', 'three.js': 'import * as T from "three"; export default T;' } }
  expect(() => rewriteAuthorModule(files, 'three.js', path => path)).toThrow('three.js 导入 three 时解析到了它自己：项目里的同名文件遮住了内置库 three')
  // 其他文件导入同名项目文件仍用项目里的副本。
  expect(rewriteAuthorModule({ ...files, files: { ...files.files, 'main.js': 'import T from "three";' } }, 'main.js', path => `blob:${path}`)).toBe('import T from "blob:three.js";')
})

it('JS 直出路径按工程记录的版本解析，未登记的裸名列出可用的内置库', () => {
  const unknown = directAuthorBundle({ entry: 'main.js', files: { 'main.js': 'import _ from "lodash";' } })!
  expect(() => rewriteAuthorModule(unknown.modules!, 'main.js', path => path)).toThrow(/找不到模块 lodash（由 main\.js 导入）。可用的内置库：three@0\.186\.1/)
  const pinned = { entry: 'main.js', apiVersion: 5 as const, files: { 'main.js': 'import * as T from "three";' }, libraries: { three: '0.999.0' } }
  expect(directAuthorBundle(pinned)!.libraries).toBeUndefined()
  expect(() => rewriteAuthorModule(pinned, 'main.js', path => path)).toThrow('找不到模块 three')
})

it('JS 直出路径的 v4 源码导入内置库时明确拒绝，也不记录库版本', () => {
  const legacy = directAuthorBundle({ entry: 'main.js', files: { 'main.js': 'import * as T from "three"; export default T;' } })!
  expect(legacy.libraries).toBeUndefined()
  expect(() => rewriteAuthorModule(legacy.modules!, 'main.js', path => path)).toThrow('main.js 导入了内置库 three：内置库从作者接口 v5 起可用，这一版按作者接口 v4 编译')
})
