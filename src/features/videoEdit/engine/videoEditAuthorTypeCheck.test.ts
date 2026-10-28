import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { APP_ACCENT_HEX } from '@/core/theme/colorTokens'
import { normalizeCodeMaterialFiles, type CodeMaterialFiles } from '@/core/videoEdit/codeMaterial/sources'
import { codeTypeDiagnosticLine } from '@/core/videoEdit/codeMaterial/typeDiagnostics'
import { createAuthorTypeChecker, type AuthorLibraryTypePackage } from './videoEditAuthorTypeCheck'
import { AUTHOR_TYPE_ENVIRONMENT } from './videoEditAuthorTypeEnvironment'

/** 与检查 Worker 同一份环境（Vite 打包的标准库、WebGPU 与作者接口声明），只是不经线程。 */
const checker = createAuthorTypeChecker(AUTHOR_TYPE_ENVIRONMENT)
const check = (input: string | CodeMaterialFiles, report?: string[]) => {
  const files = normalizeCodeMaterialFiles(input)
  return checker.check(files, report ?? Object.keys(files.files))
}
const lines = (input: string | CodeMaterialFiles, report?: string[]): string[] => check(input, report).diagnostics.map(codeTypeDiagnosticLine)
const color = JSON.stringify(APP_ACCENT_HEX)

describe('作者源码类型检查', () => {
  it('技能文档里的每个完整源码都没有类型错误（不能误报给助手照抄的写法）', () => {
    const dir = path.resolve('resources/assistant-skills/video-edit-code-creation')
    const files = [path.join(dir, 'SKILL.md'), ...fs.readdirSync(path.join(dir, 'references')).map(name => path.join(dir, 'references', name))]
    const sources = files.flatMap(file => [...fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').matchAll(/```ts\n([\s\S]*?)```/g)].map(match => ({ file: path.basename(file), source: match[1] })))
    expect(sources.length).toBeGreaterThanOrEqual(12)
    for (const { file, source } of sources) expect(lines(source), file).toEqual([])
  })

  it('按原文行列报出拼错的属性、漏写的 bounds、参数键与取值形状', () => {
    expect(lines('export default { name: "x", draw(ctx) { ctx.fillStlye = "red" } }')).toEqual([
      "main.ts:1:45 TS2551 Property 'fillStlye' does not exist on type 'OffscreenCanvasRenderingContext2D'. Did you mean 'fillStyle'?",
    ])
    expect(lines('export default { name: "x", mod: "static", draw() {} }')[0]).toMatch(/^main\.ts:1:29 TS2561 .*'mod'.*'mode'/)
    const posed = lines('export default {\n  name: "x",\n  layers() { return [{ id: "a", pose: t => ({ x: t }), draw(ctx) {} }] }\n}')
    expect(posed).toHaveLength(1)
    expect(posed[0]).toMatch(/^main\.ts:3:3 TS2322 .* → Property 'bounds' is missing in type .* but required in type 'AuthorPosedLayer'\.$/)
    expect(lines(`export default { name: "x", params: [{ key: "accent", type: "color", title: "强调色", default: ${color} }], draw(ctx, t, params) { ctx.fillStyle = params.acent } }`)[0]).toMatch(/TS2551 Property 'acent' does not exist .* Did you mean 'accent'\?$/)
    expect(lines('export default { name: "x", params: [{ key: "ink", type: "color", title: "墨色", default: [1, 0, 0, 1] }], draw(ctx, t, params) { ctx.fillStyle = params.ink } }')[0]).toMatch(/TS2322 Type 'AuthorColor' is not assignable to type 'string \| CanvasGradient \| CanvasPattern'/)
    expect(lines('export default { name: "x", draw(ctx) { ctx.roundRect(1, 2) } }')[0]).toMatch(/^main\.ts:1:45 TS2554 /)
  })

  it('模块对象另有错误时仍指向真正的字段，不把 params 推断失败报成误导的错误', () => {
    const params = '[{ key: "amount", type: "number", title: "量", default: .5, min: 0, max: 1, step: .01 }]'
    expect(lines(`export default { nmae: "x", params: ${params}, draw(ctx, t, p) { ctx.globalAlpha = p.amount } }`)).toEqual([
      "main.ts:1:18 TS2353 Object literal may only specify known properties, and 'nmae' does not exist in type 'AuthorModule<readonly AuthorParamDeclaration[]>'.",
    ])
    // 没写 params 时不推断键名：宿主照常传入空参数对象，读到的是 undefined。
    expect(lines('export default { name: "x", draw(ctx, t, p) { ctx.globalAlpha = p.amount ?? 1 } }')).toEqual([])
  })

  it('入口同一行在改写插入点之后的错误仍按原文列号', () => {
    const source = 'const unused = 1; export default { name: "x", draw(ctx) { ctx.fillStlye = "red" } }; const late: number = "s"'
    const [typo, late] = check(source).diagnostics
    expect(source.slice(typo.span.start, typo.span.end)).toBe('fillStlye')
    expect(source.slice(late.span.start, late.span.end)).toBe('late')
    expect(late.span.startColumn).toBe(source.indexOf('late') + 1)
  })

  it('不报运行时照常接受的写法：未注解的工厂、this 上的状态、展开定长参数、外链与着色器导入', () => {
    expect(lines(`import shader from "./fx.wgsl"
import * as remote from "https://cdn.example.com/lib.js"
const pad = (ctx, point) => { ctx.moveTo(...point) }
function card(index) { return { id: "c" + index, bounds: [0, 0, 10, 10], pose: t => ({ x: t * index }), draw(ctx) { pad(ctx, [1, 2]); ctx.fillRect(0, 0, 10, 10) } } }
const effect = {
  name: "x", params: [{ key: "n", type: "number", title: "n", min: 0, max: 1, step: .1, default: .5 }],
  layers(params) { void shader; void remote; this.cache ??= new OffscreenCanvas(4, 4); return [...[1, 2].map(card), { id: "s", draw(ctx) { ctx.globalAlpha = params.n } }] }
}
export default effect`)).toEqual([])
    expect(check({ entry: 'main.ts', files: { 'main.ts': 'export default {name:"x",draw(){}}', 'fx.wgsl': '@vertex fn vs() {}' } }).checkedFiles).toEqual(['main.ts'])
  })

  it('按打包器的同一规则连接多文件与钉住的项目组件，只报告指定文件', () => {
    const files: CodeMaterialFiles = { entry: 'main.ts', files: {
      'main.ts': 'import { plate } from "./lib/plate"\nimport { badge } from "@组件/徽章@2"\nexport default { name: "x", layers(params, width, height) { return [plate(width, height), badge(1)] } }',
      'lib/plate.ts': 'export function plate(width: number, height: number): AuthorLayer { return { id: "p", bounds: [0, 0, width, height], draw(ctx) { ctx.fillRect(0, 0, width, "h") } } }',
      '项目组件/徽章/v2.ts': 'export function badge(size: number): AuthorLayer { return { id: "b", draw(ctx) { ctx.lineWidth = "x" } } }',
    }, resolvedImports: { 'main.ts': { '@组件/徽章@2': '项目组件/徽章/v2.ts' } } }
    expect(lines(files, ['main.ts', 'lib/plate.ts'])).toEqual([
      "lib/plate.ts:1:156 TS2345 Argument of type 'string' is not assignable to parameter of type 'number'.",
    ])
  })

  it('JS 只在开头写 // @ts-check 时检查，// @ts-nocheck 关闭检查', () => {
    const body = 'export default { name: "x", draw(ctx) { ctx.fillStlye = "red" } }'
    expect(check({ entry: 'main.js', files: { 'main.js': body } })).toMatchObject({ checkedFiles: [], total: 0 })
    expect(lines({ entry: 'main.js', files: { 'main.js': `// @ts-check\n${body}` } })[0]).toMatch(/^main\.js:2:45 TS2551 /)
    expect(check(`// @ts-nocheck\n${body}`)).toMatchObject({ checkedFiles: [], total: 0 })
  })
})

/** 与构建脚本写进 types.json 的内容相同：类型包的声明文件，加上实际随包的运行时模块（这里按来源包近似）。 */
function nodeModulesTypes(library: string, version: string): AuthorLibraryTypePackage | undefined {
  if (library === 'three') {
    const typesRoot = path.resolve(`node_modules/henji-author-three-types-${version}`), runtimeRoot = path.resolve(`node_modules/henji-author-three-${version}`)
    const walk = (directory: string, pattern: RegExp): string[] => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.name === 'node_modules' ? [] : entry.isDirectory() ? walk(path.join(directory, entry.name), pattern) : pattern.test(entry.name) ? [path.join(directory, entry.name)] : [])
    const relative = (base: string, file: string): string => path.relative(base, file).split(path.sep).join('/')
    const files = Object.fromEntries([path.join(typesRoot, 'package.json'), ...walk(typesRoot, /\.d\.ts$/)].map(file => [relative(typesRoot, file), fs.readFileSync(file, 'utf8')]))
    const modules = [...walk(path.join(runtimeRoot, 'build'), /\.js$/), ...walk(path.join(runtimeRoot, 'examples/jsm'), /\.js$/)].map(file => relative(runtimeRoot, file)).filter(file => file !== 'examples/jsm/loaders/TTFLoader.js')
    return { mount: '@types/three', modules, files }
  }
  if (library === 'opentype.js') return { mount: 'opentype.js', modules: ['opentype.mjs'], files: { 'package.json': JSON.stringify({ name: 'opentype.js', types: 'index.d.ts' }), 'index.d.ts': fs.readFileSync(path.resolve(`resources/video-edit-author/libraries/opentype.js-${version}.d.ts`), 'utf8') } }
  return undefined
}

describe('作者源码导入内置库', () => {
  const libraryChecker = createAuthorTypeChecker({ ...AUTHOR_TYPE_ENVIRONMENT, libraryTypes: nodeModulesTypes })
  const libraryLines = (input: string | CodeMaterialFiles): string[] => {
    const files = normalizeCodeMaterialFiles(input)
    return libraryChecker.check(files, Object.keys(files.files)).diagnostics.map(codeTypeDiagnosticLine)
  }

  it('three、three/webgpu、three/addons 与 opentype.js 按真实类型解析，不报找不到模块', () => {
    expect(libraryLines(`import * as THREE from "three"
import { MeshBasicNodeMaterial } from "three/webgpu"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { SimplexNoise } from "three/examples/jsm/math/SimplexNoise.js"
import { parse } from "opentype.js"
const scene = new THREE.Scene(); scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new MeshBasicNodeMaterial()))
void new GLTFLoader(); void new SimplexNoise().noise(0, 0)
export const font = (bytes: ArrayBuffer) => parse(bytes).getPath("痕迹", 0, 0, 72).toPathData(2)
export default { name: "x", draw() { void scene } }`)).toEqual([])
  })

  it('three 接管宿主的 WebGL 上下文：gl.canvas 是 OffscreenCanvas，canvas 与 context 一起交给 WebGLRenderer', () => {
    expect(libraryLines(`import * as THREE from "three"
export default {
  name: "x",
  createWebGL(gl: WebGL2RenderingContext) {
    const canvas: OffscreenCanvas = gl.canvas
    const renderer = new THREE.WebGLRenderer({ canvas: gl.canvas, context: gl })
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, canvas.width / canvas.height)
    return { draw() { renderer.render(scene, camera) }, dispose() { renderer.dispose() } }
  },
}`)).toEqual([])
  })

  it('库里的类型错误按原文行列报出；没随包的子路径照实报找不到模块', () => {
    const source = 'import * as THREE from "three"\nconst v = new THREE.Vector3()\nv.lenght()\nexport default { name: "x", draw() { void v } }'
    const [typo] = libraryChecker.check(normalizeCodeMaterialFiles(source), ['main.ts']).diagnostics
    expect(typo).toMatchObject({ code: 2551, span: { startLine: 3, startColumn: 3 } })
    expect(source.slice(typo.span.start, typo.span.end)).toBe('lenght')
    expect(libraryLines('import { TTFLoader } from "three/addons/loaders/TTFLoader.js"\nexport default { name: "x", draw() { void TTFLoader } }')[0]).toMatch(/^main\.ts:1:27 TS2307 /)
  })

  it('读不到类型包时导入按 any 处理，不诱导删掉导入', () => {
    const untyped = createAuthorTypeChecker({ ...AUTHOR_TYPE_ENVIRONMENT, libraryTypes: () => undefined })
    const files = normalizeCodeMaterialFiles('import * as THREE from "three"\nimport { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"\nexport default { name: "x", draw() { void new THREE.Scene(); void GLTFLoader } }')
    expect(untyped.check(files, ['main.ts']).diagnostics).toEqual([])
  })
})

describe('Worker 里读取内置库类型包', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('同步读取带超时；读失败只短时记住，过后重试，读到的常驻', () => {
    vi.useFakeTimers()
    const timeouts: number[] = []
    let available = false
    vi.stubGlobal('XMLHttpRequest', class {
      status = 0; responseText = ''; timeout = 0
      open(): void {}
      send(): void {
        timeouts.push(this.timeout)
        if (!available) throw new DOMException('timed out', 'TimeoutError')
        this.status = 200; this.responseText = JSON.stringify({ mount: '@types/three', modules: [], files: {} })
      }
    })
    const read = AUTHOR_TYPE_ENVIRONMENT.libraryTypes!
    // 用一个别的测试不会读的版本号，避开模块级缓存。
    expect(read('three', '9.9.9')).toBeUndefined()
    available = true
    expect(read('three', '9.9.9')).toBeUndefined()
    vi.advanceTimersByTime(31_000)
    expect(read('three', '9.9.9')).toMatchObject({ mount: '@types/three' })
    expect(read('three', '9.9.9')).toMatchObject({ mount: '@types/three' })
    expect(timeouts).toEqual([5000, 5000])
  })
})
