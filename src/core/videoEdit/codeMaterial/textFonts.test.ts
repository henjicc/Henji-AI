import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { resolveTextFontPreparation } from './textFontPreparation'
import { readStaticTextFonts } from './textFonts'

const read = (source: string, version = 10) => readStaticTextFonts(ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true), version)
describe('静态字体声明与 API 隔离', () => {
  it('解析字面量、常量引用与导出别名，不执行动态作者代码', () => {
    const source = `const family = 'Example'; const declaration = { faces: [{ family, weight: 700, variations: { wght: 700 } }], scripts: ['Latn', 'Emoji'], bindings: [{text: 'title', style: 'titleStyle'}] } as const; export { declaration as textFonts }; export default {params:[{key:'title',type:'text',default:'标题'}, {key:'titleStyle',type:'textStyle',default:{fontFamily:family}}], draw(){}}; throw new Error('must not run')`
    expect(read(source).declaration.faces?.[0]).toEqual({ family: 'Example', weight: 700, variations: { wght: 700 } })
    expect(read(source).diagnostics).toEqual([])
    expect(read(source).defaults).toEqual({ title: '标题', titleStyle: { fontFamily: 'Example' } })
    expect(read('export const textFonts = getFonts()').diagnostics[0].message).toContain('动态表达式')
    expect(read('const a=b; const b=a; export const textFonts=a').diagnostics).toHaveLength(1)
    for (const value of ['export let textFonts={}', 'export function textFonts(){}', `export {declaration as textFonts} from './fonts.js'`]) expect(read(value).diagnostics).toEqual([expect.objectContaining({ severity: 'error' })])
  })
  it('绑定默认值未知时只诊断，不能执行参数工厂或限制作者表达', () => {
    const binding = `export const textFonts={bindings:[{text:'title',style:'style'}]};`
    for (const params of ['buildParameters()', `[{key:'title',type:'text',default:'标题'}]`]) {
      expect(read(`${binding} export default {params:${params},draw(){}}`).diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ severity: 'warning' })]))
    }
  })
  it('零声明可用默认集；字面自定义字体与 forceGraphemes 提示只作用 API10', () => {
    const source = `import {layoutText as layout} from 'henji-layout/text'; layout('title', {fontFamily:'Example'}, {forceGraphemes:true})`
    expect(read('').declaration).toEqual({})
    expect(read(source).diagnostics.map(item => item.message)).toEqual([expect.stringContaining('忽略 forceGraphemes')])
    expect(read(source).styleUses).toContainEqual({ style: { fontFamily: 'Example' } })
    expect(read(source, 7).diagnostics).toEqual([])
    expect(read(`export const textFonts={faces:[{family:'Example'}]}; ${source}`).diagnostics).toHaveLength(1)
  })
  it('text、table、flex 收集字面样式和对象展开，参数覆盖保留最后字重', () => {
    const value = read(`import {layoutText} from 'henji-layout/text'; import {layoutTable} from 'henji-layout/table'; import {layoutBoxes} from 'henji-layout/flex';
      const style={fontFamily:'Example',fontStyle:'italic'};
      layoutText('标题',{...style,fontWeight:700}); layoutText('正文',{...params.style,fontWeight:700});
      layoutTable({rows:[{a:{text:'单元格',style:{fontWeight:700}}}]}); layoutBoxes({text:{content:'盒子',style:{fontStyle:'italic'}}});`)
    expect(value.styleUses).toEqual(expect.arrayContaining([
      { style: { fontFamily: 'Example', fontStyle: 'italic', fontWeight: 700 } },
      { parameter: 'style', style: { fontWeight: 700 } },
      { style: { fontStyle: 'italic' } },
    ]))
    expect(value.declaration.text).toEqual(expect.arrayContaining(['标题', '单元格', '盒子']))
  })
})

it('正文与样式分别提取，常量样式和参数展开保持覆盖顺序', () => {
  const value = read(`import {layoutText} from 'henji-layout/text'; const style={fontFamily:'Georgia',fontWeight:700};
    layoutText('Hello',style); layoutText(params.title,{fontFamily:'sans-serif'}); layoutText(getTitle(),{fontFamily:'Arial'});
    layoutText('覆盖',{fontWeight:700,...params.style});`)
  expect(value.declaration.text).toEqual(['Hello', '覆盖'])
  expect(value.styleUses).toContainEqual({style:{fontFamily:'Georgia',fontWeight:700}})
  expect(value.styleUses).toContainEqual({parameter:'style',style:{}})
  expect(value.textParameters).toEqual(['title'])
  expect(value.dynamicText).toBe(true)
  const prepared = resolveTextFontPreparation(value,{title:'中文标题',style:{fontWeight:400}})
  expect(prepared.text).toBeUndefined()
})

it('表格字符串单元格和跨层合并样式完整进入准备', () => {
  const value = read(`import {layoutText} from 'henji-layout/text'; import {layoutTable} from 'henji-layout/table';
    layoutText('Hello'); layoutTable({style:{fontFamily:'Georgia'},columns:[{key:'name'}],rows:[{name:'ภาษาไทย'},{name:{text:'标题',style:{fontWeight:700}}}]})`)
  expect(value.declaration.text).toEqual(expect.arrayContaining(['Hello','ภาษาไทย','标题']))
  expect(value.styleUses).toContainEqual({style:{fontFamily:'Georgia',fontWeight:700}})
})

const drawn = (call: string, prelude = '') => read(`import {layoutText} from 'henji-layout/text';import {layoutTable} from 'henji-layout/table';import {layoutBoxes} from 'henji-layout/flex';${prelude}
  export default {params:[{key:'label',type:'text',default:'A'}],draw(ctx,time,params){${call}}}`)
const prepared = (resource: ReturnType<typeof read>, values?: Record<string, unknown>) => resolveTextFontPreparation(resource, values).text?.join('')
it('与参数拼接的模块常量、常量数组下标和分隔符逐字进入准备', () => {
  for (const [prelude, call] of [
    [`const MARK='★①';`, 'layoutText(params.label+MARK)'],
    [`const ICONS=['✓','한'];`, 'layoutText(`${params.label}${ICONS[0]}${ICONS[1]}`)'],
    [`const SEP='𠀀';`, 'layoutText(params.items.map(i=>i.name).join(SEP))'],
  ]) {
    const resource = drawn(call, prelude)
    expect(resource.dynamicText).toBeUndefined()
    const text = prepared(resource, { label: 'x', items: [{ name: 'y' }] })!
    for (const character of ['★', '①', '✓', '한', '𠀀'].filter(value => prelude.includes(value))) expect(text).toContain(character)
  }
})
it('宽度、id、表格选项与列宽不是文字位置，计算值不触发完整候选', () => {
  for (const call of [
    "layoutTable({columns:[{key:'a',width:ctx.width/2}],rows:[{a:'收入'}]},{width:ctx.width-240,cellPadding:compute()})",
    "for(let i=0;i<3;i++) layoutBoxes({id:'r'+i,style:{width:ctx.width/3,padding:pad()},children:[{id:'t'+i,text:{content:'盒子',options:{maxLines:lines()}}}]},{width:ctx.width,height:ctx.height})",
    "layoutText({paragraphs:[{align:pick(),runs:[{text:'富文本',style:{fontSize:ctx.width/10}}]}],box:{x:0,y:0,width:ctx.width,height:100}},{fontSize:size()})",
  ]) {
    const resource = drawn(call)
    expect(resource.dynamicText, call).toBeUndefined()
    expect(prepared(resource)).toMatch(/收入|盒子|富文本/)
  }
})
it('局部常量、循环、回调、解构与传入作者参数的辅助函数都能逐字证明', () => {
  const cases = [
    "const title=params.label+'！'; layoutText(title)",
    'for(const row of params.rows) layoutText(row.title)',
    'params.rows.forEach((row,i)=>layoutText(`${i+1}. ${row.title}`))',
    'const {label}=params; layoutText(label.slice(0,2))',
    "layoutText(`${Math.round(time*100)}%`); layoutText((time*3).toFixed(1)+'s')",
    "layoutTable({columns:[{key:'a'}],rows:params.rows.map(row=>({a:{text:row.title,style:{fontWeight:700}}}))})",
  ]
  for (const call of cases) expect(drawn(call).dynamicText, call).toBeUndefined()
  const helper = read(`import {layoutText} from 'henji-layout/text'; function caption(p){ return layoutText(p.label) }
    export default {draw(ctx,time,params){ caption(params) }}`)
  expect(helper.dynamicText).toBeUndefined()
  expect(helper.textParameters).toEqual(['label'])
  expect(prepared(drawn('for(const row of params.rows) layoutText(row.title)'), { rows: [{ title: '★' }] })).toContain('★')
})
it('不能证明字面量的写法一律准备完整默认候选集', () => {
  const cases: Array<[string, string?]> = [
    ['layoutText(title())', 'function title(){return "常量"}'],
    ["LINES.push(params.label+fetchText()); layoutText(LINES.join('|'))", 'const LINES=[];'],
    ["ROW.a=load(); layoutTable({columns:[{key:'a'}],rows:[ROW]})", "const ROW={a:'x'};"],
    ['layoutText(ICONS[0])', "export const ICONS=['✓'];"],
    ['const alias=ICONS; alias.push(load()); layoutText(ICONS[1])', "const ICONS=['✓'];"],
    ['mutate(ICONS); layoutText(ICONS[0])', "const ICONS=['✓'];"],
    ['const f=layoutText; f(load())'],
    ['params.items.map(layoutText)'],
    ['layoutText(params.label.toLowerCase())'],
    ['layoutText(params[key])'],
    ['layoutText(p.label)', 'const p=load();'],
    ['import(name).then(m=>m.draw())'],
    ["eval('ICONS.push(load())'); layoutText(ICONS[0])", "const ICONS=['✓'];"],
  ]
  for (const [call, prelude] of cases) expect(drawn(call, prelude).dynamicText, call).toBe(true)
  const helper = read(`import {layoutText} from 'henji-layout/text'; function caption(p){ return layoutText(p.label) } caption({label:load()})
    export default {draw(ctx,time,params){ caption(params) }}`)
  expect(helper.dynamicText).toBe(true)
  for (const source of [`export {layoutText} from 'henji-layout/text'`, `export * from 'henji-layout/text'`]) expect(read(source)).toMatchObject({ usesText: true, dynamicText: true })
})
it('纯字面量模块只准备自己的字符，大写形式一起准备', () => {
  const resource = drawn("layoutText(`${TITLE} ${ICONS[1]}`,{allCaps:true}); layoutBoxes({id:'root',children:ICONS.map(icon=>({id:icon,text:{content:icon}}))},{width:100,height:100})", "const TITLE='straße'; const ICONS=['✓','한'];")
  expect(resource.dynamicText).toBeUndefined()
  expect(new Set(resolveTextFontPreparation(resource).text)).toEqual(new Set(['straße', ' ', '한', '✓', 'STRASSE']))
})
