import fs from 'node:fs'
import ts from 'typescript'
import { convert } from 'fontverter'
import { beforeAll, expect, it } from 'vitest'
import { readStaticTextFonts } from '@/core/videoEdit/codeMaterial/textFonts'
import type { CodeAuthorBundle } from '@/core/videoEdit/codeAuthorProgram'
import { TextFontSession } from '@/core/imaging/vectorContent/shaping/fontPolicy'
import { withTextFontSession } from '@/core/imaging/vectorContent/shaping/fontContext'
import type { TextFontLease } from '@/core/imaging/vectorContent/shaping/fontChannel'
import { layoutText } from '../authorLibraries/text'
import { layoutTable } from '../authorLibraries/table'
import { layoutBoxes, ready } from '../authorLibraries/flex'
import { AuthorTextResources } from './videoEditAuthorTextResources'
import type { AuthorModule } from './videoEditAuthorModule'

/*
 * 执行核对：随机组合作者常用的文字写法，真实执行正式排版，断言准备集覆盖实际交给字体选择的全部字符。
 * 固定种子保证失败可复现；把失败用例的 source 贴进 textFonts.test 即可单独调试。
 */
const SEED = 0x7e47, MODULES = 360
const PIECES = ['Ab', '标题', '★', '✓', '①', '한', '𠀀', 'é', '·', ' ', '👍', 'ß', '第2行']
type Level = 'literal' | 'known' | 'any'
function random(seed: number): () => number {
  let state = seed >>> 0
  return () => { state = state + 0x6d2b79f5 >>> 0; let value = Math.imul(state ^ state >>> 15, 1 | state); value ^= value + Math.imul(value ^ value >>> 7, 61 | value); return ((value ^ value >>> 14) >>> 0) / 4294967296 }
}
function generate(next: () => number, level: Level): { source: string; values: Record<string, unknown> } {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]
  const piece = () => pick(PIECES), literal = () => JSON.stringify(piece())
  const prelude: string[] = [], locals: string[] = []
  let counter = 0
  const constant = (): string => { const name = `C${counter++}`; prelude.push(`const ${name} = ${literal()}`); return name }
  const array = (): { name: string; length: number } => { const name = `A${counter++}`, length = 1 + Math.floor(next() * 3); prelude.push(`const ${name} = [${Array.from({ length }, literal).join(', ')}]`); return { name, length } }
  // 函数返回值与运行时改写的数组画出源码里没有的字符，分析误判为已知时必然漏字。
  const secret = (): string => `String.fromCodePoint(${0x2600 + Math.floor(next() * 200)})`
  const expression = (depth: number): string => {
    const forms: Array<() => string> = [
      literal, constant,
      () => { const { name, length } = array(); return `${name}[${Math.floor(next() * length)}]` },
      () => { const { name } = array(); return `${name}.join(${next() < .5 ? literal() : constant()})` },
      () => { const name = `v${counter++}`; locals.push(`const ${name} = ${expression(depth + 1)}`); return name },
    ]
    if (depth < 3) forms.push(
      () => `\`${piece()}\${${expression(depth + 1)}}${piece()}\${${expression(depth + 1)}}\``,
      () => `${expression(depth + 1)} + ${expression(depth + 1)}`,
      () => `(time > 1 ? ${expression(depth + 1)} : ${expression(depth + 1)})`,
    )
    if (level !== 'literal') forms.push(
      () => `params.${pick(['t0', 't1'])}`,
      () => `params.${pick(['t0', 't1'])}.slice(${Math.floor(next() * 2)}, ${2 + Math.floor(next() * 3)})`,
      () => `params.list.map(item => item.name).join(${expression(depth + 1)})`,
      () => `\`\${Math.round(time * ${1 + Math.floor(next() * 300)})}%\``,
      () => `String(params.count) + ${expression(depth + 1)}`,
      () => `(time * 3).toFixed(${Math.floor(next() * 3)})`,
    )
    if (level === 'any') forms.push(
      () => { const name = `f${counter++}`; prelude.push(`function ${name}() { return ${secret()} }`); return `${name}()` },
      () => { const name = `L${counter++}`; prelude.push(`const ${name} = []`); locals.push(`${name}.push(${secret()})`); return `${name}.join('')` },
      () => { const name = `O${counter++}`; prelude.push(`const ${name} = { text: ${literal()} }`); locals.push(`${name}.text = ${secret()}`); return `${name}.text` },
      () => `params.${pick(['t0', 't1'])}.toLowerCase()`,
      () => `[${secret()}].map(value => value)[0]`,
    )
    return pick(forms)()
  }
  const statements = Array.from({ length: 1 + Math.floor(next() * 3) }, () => pick<() => string>([
    () => `layoutText(${expression(0)}, { fontSize: 20 })`,
    () => `layoutTable({ columns: [{ key: 'a', width: ctx.width / 2 }, { key: 'b' }], rows: [{ a: ${expression(0)}, b: { text: ${expression(0)}, style: { fontWeight: 700 } } }] }, { width: ctx.width - 10, cellPadding: 2 })`,
    () => `for (let i = 0; i < 2; i++) layoutBoxes({ id: 'n' + i, style: { width: ctx.width / 2 }, children: [{ id: 'c' + i, text: { content: ${expression(0)} } }] }, { width: ctx.width, height: 600 })`,
    () => { const { name } = array(); return `${name}.forEach((value, index) => layoutText(value + index))` },
    ...level === 'literal' ? [] : [() => `for (const row of params.rows) layoutText(row.title + ${expression(0)})`],
  ])())
  const text = () => Array.from({ length: 1 + Math.floor(next() * 3) }, piece).join('')
  const values = { t0: text(), t1: text(), count: Math.floor(next() * 1000) / 10, list: [{ name: text() }, { name: text() }], rows: [{ title: text() }] }
  const declarations = Object.entries(values).map(([key, value]) => `{ key: '${key}', type: '${typeof value === 'string' ? 'text' : typeof value === 'number' ? 'number' : 'list'}', default: ${JSON.stringify(value)} }`)
  const source = `${prelude.join('\n')}\nexport default { name: 'coverage', params: [${declarations.join(', ')}], draw(ctx, time, params) {\n${[...locals, ...statements].join('\n')}\n} }`
  return { source, values: { t0: text(), t1: text(), count: values.count + 1, list: [{ name: text() }], rows: [{ title: text() }, { title: text() }] } }
}

let fontBytes: ArrayBuffer
beforeAll(async () => {
  await ready
  const bytes = await convert(fs.readFileSync('node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2'), 'sfnt')
  fontBytes = Uint8Array.from(bytes).buffer
})

it('随机组合的文字写法：准备集覆盖实际排版的全部字符，可证明的写法不退回完整候选集', async () => {
  const fonts = new TextFontSession('win32', async () => ({ bytes: fontBytes.slice(0) }))
  const next = random(SEED), summary = { literal: 0, known: 0, any: 0, full: 0, characters: 0 }
  try {
    for (let index = 0; index < MODULES; index++) {
      const level: Level = (['literal', 'known', 'any'] as const)[index % 3]
      const { source, values } = generate(next, level)
      const module = `import { layoutText } from 'henji-layout/text'; import { layoutTable } from 'henji-layout/table'; import { layoutBoxes } from 'henji-layout/flex';\n${source}`
      const resource = readStaticTextFonts(ts.createSourceFile('main.js', module, ts.ScriptTarget.Latest, true), 10)
      expect(resource.diagnostics.filter(item => item.severity === 'error'), source).toEqual([])
      const effect = new Function('layoutText', 'layoutTable', 'layoutBoxes', `'use strict';\n${source.replace('export default', 'return')}`)(layoutText, layoutTable, layoutBoxes) as AuthorModule
      const prepared: Array<readonly string[] | undefined> = [], drawn: string[] = []
      const prepare = fonts.prepare.bind(fonts), choose = fonts.choose.bind(fonts)
      fonts.prepare = (declaration, signal) => { prepared.push(declaration?.text); return prepare(declaration, signal) }
      fonts.choose = (chain, grapheme, ...rest) => { drawn.push(grapheme); return choose(chain, grapheme, ...rest) }
      const lease: TextFontLease = { fonts, revision: 1, release() {} }
      const bundle: CodeAuthorBundle = { code: '', map: '', locations: { layers: {} }, apiVersion: 10, libraries: { 'henji-layout': '2.0.0' }, textEntry: 'main.js', textFonts: [{ file: 'main.js', ...resource }] }
      const resources = new AuthorTextResources(lease, bundle)
      try {
        resources.bind(effect)
        const text = await resources.prepare(values)
        withTextFontSession(text.fonts, () => effect.draw!({ width: 800, height: 600 } as unknown as OffscreenCanvasRenderingContext2D, 1.5, values, 800, 600, {}, { time: 1.5, frameDuration: 1 / 30, clip: { time: 1.5, duration: 5 } } as never))
      } finally { resources.close(); delete (fonts as Partial<TextFontSession>).prepare; delete (fonts as Partial<TextFontSession>).choose }
      expect(prepared, source).toHaveLength(1)
      const declared = prepared[0]
      if (level !== 'any') expect(declared, `${level} 写法退回完整候选集：\n${source}`).toBeDefined()
      if (declared === undefined) { summary.full++; continue }
      const covered = new Set([...declared.join('')])
      // 按 UTF-16 截取会切开代理对；孤立代理项不是 Unicode 字符，任何字体都没有它的字形。
      const missing = [...new Set(drawn.flatMap(grapheme => [...grapheme]))].filter(character => !covered.has(character) && !/^[\ud800-\udfff]$/.test(character))
      expect(missing, `准备集漏字：\n${source}\n参数 ${JSON.stringify(values)}`).toEqual([])
      summary[level]++; summary.characters += drawn.length
    }
  } finally { fonts.close() }
  // 生成器确实覆盖了三类写法：动态写法里既有被证明的组合，也有必须退回完整候选集的组合。
  expect(summary.literal).toBe(MODULES / 3)
  expect(summary.known).toBe(MODULES / 3)
  expect(summary.full).toBeGreaterThan(MODULES / 12)
  expect(summary.any).toBeGreaterThan(0)
  expect(summary.characters).toBeGreaterThan(MODULES * 5)
}, 120_000)
