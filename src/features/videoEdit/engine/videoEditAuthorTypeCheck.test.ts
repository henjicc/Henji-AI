import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { APP_ACCENT_HEX } from '@/core/theme/colorTokens'
import { normalizeCodeMaterialFiles, type CodeMaterialFiles } from '@/core/videoEdit/codeMaterial/sources'
import { codeTypeDiagnosticLine } from '@/core/videoEdit/codeMaterial/typeDiagnostics'
import { createAuthorTypeChecker } from './videoEditAuthorTypeCheck'
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
