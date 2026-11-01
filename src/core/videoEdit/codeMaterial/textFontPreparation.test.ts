import ts from 'typescript'
import fs from 'node:fs'
import { convert } from 'fontverter'
import { expect, it, vi } from 'vitest'
import { readStaticTextFonts } from './textFonts'
import { prepareTextFontResources, resolveTextFontPreparation } from './textFontPreparation'
import { TextFontSession } from '../../imaging/vectorContent/shaping/fontPolicy'

const read = (source: string) => readStaticTextFonts(ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true), 10)
it('无绑定的字体参数与绑定富文本均进入准备，实际值覆盖默认且不丢声明字体', () => {
  const resource = read(`export const textFonts={faces:[{family:'Fixed',variations:{wght:650}}],text:['常量'],scripts:['Kana'],bindings:[{text:'title',style:'style'}]}; export default {params:[{key:'title',type:'text',default:'默认'},{key:'style',type:'textStyle'},{key:'font',type:'font',default:'Default'}],draw(){}}`)
  expect(resource.diagnostics).toEqual([])
  expect(resolveTextFontPreparation(resource).text).toEqual(['常量', '默认'])
  const prepared = resolveTextFontPreparation(resource, { font: 'Selected', style: { fontFamily: 'Title', fontWeight: 700 }, title: { box: { x: 0, y: 0, width: 0, height: 0 }, paragraphs: [{ direction: 'auto', spaceBefore: 0, spaceAfter: 0, runs: [{ text: '日本語👨‍👩‍👧', style: { fontFamily: 'Run', fontStyle: 'italic' } }] }] } })
  expect(new Set(prepared.faces?.map(face => face.family))).toEqual(new Set(['sans-serif', 'Fixed', 'Title', 'Selected', 'Run']))
  expect(prepared.faces).toContainEqual({ family: 'Title', weight: 700, style: 'normal' })
  expect(prepared.text).toEqual(['常量', '日本語👨‍👩‍👧'])
  expect(prepared.scripts).toEqual(['Kana'])
})

it('依赖模块不接收入口同名参数，屏障等待所有字体，重复准备复用同一内容身份', async () => {
  const resource = read(`export default {params:[{key:'font',type:'font',default:'Dependency'}],draw(){}}`)
  const bytes = await convert(fs.readFileSync('node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2'), 'sfnt')
  let finish!: () => void
  const readFont = vi.fn(async (request: { family: string }) => {
    if (request.family === 'Dependency') await new Promise<void>(resolve => { finish = resolve })
    return { bytes: Uint8Array.from(bytes).buffer }
  })
  const fonts = new TextFontSession('win32', readFont)
  const resources = [{ ...resource, file: 'main.js' }, { ...resource, file: 'child.js' }]
  const ready = vi.fn()
  const pending = prepareTextFontResources(fonts, resources, 'main.js', { font: 'Entry' }).then(identity => { ready(); return identity })
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  expect(ready).not.toHaveBeenCalled()
  finish()
  const { identity } = await pending, calls = readFont.mock.calls.length
  expect(identity).toContain('dependency')
  expect(identity).toContain('entry')
  expect((await prepareTextFontResources(fonts, resources, 'main.js', { font: 'Entry' })).identity).toBe(identity)
  expect(readFont).toHaveBeenCalledTimes(calls)
  await expect(prepareTextFontResources(fonts, [{ file: 'broken.js', ...resource }], 'broken.js', { font: 9 })).rejects.toThrow('broken.js')
  fonts.close()
})

it('切片、模板字符串与数组/JSON 的实际字符进入准备，未知动态来源准备完整候选', () => {
  for (const expression of ['params.text.slice(0, count)', '`前缀${params.text}`', 'JSON.parse(params.text).map(x => x.title).join(" ")']) {
    const resource = read("import {layoutText} from 'henji-layout/text'; layoutText(" + expression + ");")
    expect(resource.dynamicText).toBeUndefined()
    for (const value of ['★ ✓ ① 한 𠀀', [{ title: '★ ✓ ① 한 𠀀' }], '[{"title":"★ ✓ ① 한 𠀀"}]', '["\\u2605"]']) {
      const result = resolveTextFontPreparation(resource, { text: value })
      expect(result.text?.join('')).toContain('★')
    }
  }
  expect(resolveTextFontPreparation(read("import {layoutText} from 'henji-layout/text'; layoutText(externalData());")).text).toBeUndefined()
})

it('同模块静态文字不会掩盖参数生成的 flex 子树和动态表格行', () => {
  for (const call of [
    "layoutBoxes({id:'root',children:params.rows.map(row=>({id:row.id,text:{content:row.title}}))},size)",
    "layoutTable({rows:params.rows.map(row=>({title:row.title}))})",
  ]) {
    const resource = read("import {layoutText} from 'henji-layout/text';import {layoutBoxes} from 'henji-layout/flex';import {layoutTable} from 'henji-layout/table'; layoutText('Hello');" + call)
    expect(resource.dynamicText).toBeUndefined()
    expect(resolveTextFontPreparation(resource, { rows: [{ id: 'a', title: '★✓①한𠀀' }] }).text?.join('')).toContain('★✓①한𠀀')
  }
  const unknown = read("import {layoutText} from 'henji-layout/text';import {layoutBoxes} from 'henji-layout/flex'; layoutText('Hello');layoutBoxes({children:loadRows()},size)")
  expect(resolveTextFontPreparation(unknown).text).toBeUndefined()
})
