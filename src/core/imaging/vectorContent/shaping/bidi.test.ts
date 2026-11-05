import { expect, it } from 'vitest'
import { resolveBidi, visualOrder } from './bidi'

const show = (text: string, base: 'auto' | 'ltr' | 'rtl') => {
  const levels = resolveBidi(text, base)?.levels
  const items = [...text].map((char, index) => ({ char, level: levels?.[index] ?? 0 }))
  return visualOrder(items).map(item => item.char).join('')
}

it('从右到左的文字整段反向，夹在里面的数字和拉丁字母仍从左到右', () => {
  expect(show('אבג 123 דה', 'auto')).toBe('הד 123 גבא')
  expect(show('אב cd גד', 'rtl')).toBe('דג cd בא')
})

it('基准方向由第一个强方向字符决定；中文开头时只翻转从右到左的片段', () => {
  expect(show('中文 אבג 混排', 'auto')).toBe('中文 גבא 混排')
  expect(resolveBidi('中文 abc 123', 'auto')).toBeUndefined()
})

it('非基本平面字符按真实方向类别算：表情不决定基准方向，从右到左的古文字也翻转', () => {
  expect(resolveBidi('😀 שלום', 'auto')?.paragraphs[0].level).toBe(1)
  expect(resolveBidi('שלום 😀 עולם', 'auto')?.levels[5]).toBe(1)
  expect(resolveBidi('𞤀𞤁', 'auto')?.levels[0]).toBe(1)
  expect(resolveBidi('🅰 אב', 'auto')?.paragraphs[0].level).toBe(0)
})
