/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { resolveReplayTarget } from './target'

// jsdom has no layout: each element gets the box written in its data-box attribute ("x y w h"); none means no box.
beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const [x, y, width, height] = (this.getAttribute('data-box') ?? '0 0 0 0').split(' ').map(Number)
    return { x, y, width, height, left: x, top: y, right: x + width, bottom: y + height, toJSON: () => ({}) } as DOMRect
  })
})
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = '' })

it('按选择器找看得见的第几个，落在元素里的比例位置', () => {
  document.body.innerHTML = '<button class="go"></button><button class="go" data-box="10 20 100 40"></button><button class="go" data-box="200 20 100 40"></button>'
  expect(resolveReplayTarget({ selector: '.go' })).toEqual({ x: 60, y: 40 })
  expect(resolveReplayTarget({ selector: '.go', index: 1, offset: [0, 1] })).toEqual({ x: 200, y: 60 })
  expect(resolveReplayTarget({ selector: '.go', index: 2 })).toBeNull()
  expect(resolveReplayTarget({ selector: '[[bad' })).toBeNull()
})

it('只按文字时取包含整段文字的最小元素', () => {
  document.body.innerHTML = '<div data-box="0 0 500 500"><p data-box="10 10 200 20">搜索 <b data-box="40 10 30 20">千兆</b> 交换机</p><span data-box="300 300 50 20">发送</span></div>'
  expect(resolveReplayTarget({ text: '发送' })).toEqual({ x: 325, y: 310 })
  expect(resolveReplayTarget({ text: '搜索 千兆' })).toEqual({ x: 110, y: 20 })
  expect(resolveReplayTarget({ text: '千兆' })).toEqual({ x: 55, y: 20 })
  expect(resolveReplayTarget({ selector: 'p', text: '交换机' })).toEqual({ x: 110, y: 20 })
  expect(resolveReplayTarget({ text: '没有这段' })).toBeNull()
})

it('只给坐标时就是那个点', () => {
  expect(resolveReplayTarget({ x: 3, y: 4 })).toEqual({ x: 3, y: 4 })
  expect(resolveReplayTarget({})).toBeNull()
})
