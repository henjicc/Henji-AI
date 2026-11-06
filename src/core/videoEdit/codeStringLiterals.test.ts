import { expect, it } from 'vitest'
import { codeStringLiterals, replaceUniqueCodeStringLiteral } from './codeStringLiterals'

it('跳过注释、解码转义，带插值的模板字符串不算', () => {
  const source = `// "注释里的"\nconst a = "一行字。", b = 'it\\'s', c = \`多\n行\`, d = \`\${a}后缀\` /* '块注释' */\nconst e = "\\u4e00\\n"`
  expect(codeStringLiterals(source).map(literal => literal.value)).toEqual(['一行字。', "it's", '多\n行', '一\n'])
})

it('只改唯一一处同值字面量，保留原引号并转义', () => {
  const files = { 'film.ts': 'export const lines = [{ text: "一行字。" }, { text: "放进去。" }]', 'kit.ts': "export const RED = 'red-ink'" }
  expect(replaceUniqueCodeStringLiteral(files, '一行字。', '两行"字"')).toEqual([{ path: 'film.ts', source: 'export const lines = [{ text: "两行\\"字\\"" }, { text: "放进去。" }]' }])
  expect(replaceUniqueCodeStringLiteral({ ...files, 'other.ts': 'const x = `一行字。`' }, '一行字。', '改')).toBeUndefined()
  expect(replaceUniqueCodeStringLiteral(files, '不存在', '改')).toBeUndefined()
})

it('textFonts 里的同文预载清单不算出处，但一起改', () => {
  const source = 'export const textFonts = { text: ["一行字。", "放进去。"], faces: [{ family: "A" }] }\nconst LINES = [{ text: "一行字。" }]'
  expect(replaceUniqueCodeStringLiteral({ 'main.js': source }, '一行字。', '改了')).toEqual([{ path: 'main.js', source: source.replaceAll('一行字。', '改了') }])
  expect(replaceUniqueCodeStringLiteral({ 'main.js': 'export const textFonts = { text: ["只在清单里"] }' }, '只在清单里', '改')).toBeUndefined()
})

it('只豁免 textFonts.text 清单，字体族名等字段照常算出处', () => {
  const source = 'export const textFonts = { faces: [{ family: "Noto Sans SC" }], text: ["Noto Sans SC"] }\ndraw("Noto Sans SC")'
  expect(replaceUniqueCodeStringLiteral({ 'main.js': source }, 'Noto Sans SC', '改')).toBeUndefined()
})
