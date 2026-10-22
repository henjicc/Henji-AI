import { afterEach, expect, it, vi } from 'vitest'
import { createAuthorModuleUrls, directAuthorBundle } from './videoEditAuthorModules'
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
