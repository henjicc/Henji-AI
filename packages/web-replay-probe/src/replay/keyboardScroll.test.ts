/** @vitest-environment jsdom */
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { installKeyboardScroll } from './keyboardScroll'
import { ScrollAnimator } from './smoothScroll'

// Page time and animation frames are the test's; jsdom has no layout, so scroll boxes are declared.
let now = 0
const frames: FrameRequestCallback[] = []
const offsets = new Map<Element, [number, number]>()
const top = (el: Element): number => offsets.get(el)?.[1] ?? 0
const run = (t: number): void => { now = t; for (const callback of frames.splice(0)) callback(t) }
const box = (el: Element, scrollHeight: number, clientHeight: number): void => {
  Object.defineProperties(el, {
    scrollHeight: { value: scrollHeight, configurable: true }, clientHeight: { value: clientHeight, configurable: true },
    scrollWidth: { value: 0, configurable: true }, clientWidth: { value: 0, configurable: true },
    scrollTop: { get: () => top(el), configurable: true }, scrollLeft: { get: () => offsets.get(el)?.[0] ?? 0, configurable: true },
  })
}
const press = (target: Element, key: string, type = 'keydown'): KeyboardEvent => {
  const event = new KeyboardEvent(type, { key, bubbles: true, cancelable: true, composed: true })
  target.dispatchEvent(event)
  return event
}

beforeAll(() => {
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  ;(globalThis as Record<string, unknown>).requestAnimationFrame = (callback: FrameRequestCallback) => frames.push(callback)
  box(document.documentElement, 2000, 500)
  // jsdom's events are never trusted; the browser's input is.
  installKeyboardScroll(new ScrollAnimator((el, to) => offsets.set(el, to)), () => true)
})
afterEach(() => { run(now + 10_000); document.body.innerHTML = '' })

it('方向键的滚动在页面时间上走完 150 毫秒，真实时间过去多久都不动', async () => {
  const root = document.documentElement
  offsets.set(root, [0, 0])
  now = 0
  expect(press(document.body, 'ArrowDown').defaultPrevented).toBe(true)
  run(0)
  await new Promise(resolve => setTimeout(resolve, 60))
  run(0)
  expect(top(root)).toBe(0)
  run(75)
  expect(top(root)).toBeCloseTo(20, 1)
  run(150)
  expect(top(root)).toBe(40)
  expect(frames).toHaveLength(0)
})

it('滚动中再按一次：从当前位置接着走，不回跳也不停顿，落到新的终点', () => {
  const root = document.documentElement
  offsets.set(root, [0, 0])
  now = 1000
  press(document.body, 'ArrowDown')
  const seen: number[] = []
  for (let t = 1000; t <= 1075; t += 15) { run(t); seen.push(top(root)) }
  press(document.body, 'ArrowDown')
  for (let t = 1090; t <= 1400; t += 15) { run(t); seen.push(top(root)) }
  expect(seen.at(-1)).toBe(80)
  for (let i = 1; i < seen.length; i += 1) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1])
  // Speed carries over the retarget (index 5 is t=1075): a fresh ease-in from rest would crawl here instead.
  expect(seen[6] - seen[5]).toBeGreaterThan((seen[5] - seen[4]) * 0.8)
})

it('页面自己处理了的按键不接管，包括页面挂在 window 上、比接管登记得晚的监听；输入框里的方向键也不接管', () => {
  const root = document.documentElement
  offsets.set(root, [0, 100])
  const prevent = (event: Event): void => { if ((event as KeyboardEvent).key === 'PageDown') event.preventDefault() }
  addEventListener('keydown', prevent)
  press(document.body, 'PageDown')
  removeEventListener('keydown', prevent)
  const input = document.body.appendChild(document.createElement('input'))
  input.focus()
  expect(press(input, 'ArrowDown').defaultPrevented).toBe(false)
  expect(frames).toHaveLength(0)
  expect(top(root)).toBe(100)
})

it('焦点所在的滚动框先滚，空格按页滚；滚到底再按就交给外层', () => {
  const root = document.documentElement
  offsets.set(root, [0, 0])
  const list = document.body.appendChild(document.createElement('div'))
  list.style.overflowY = 'auto'
  box(list, 400, 200)
  const item = list.appendChild(document.createElement('div'))
  item.tabIndex = 0
  item.focus()
  now = 0
  press(item, ' ', 'keypress')
  run(0); run(200)
  // A page is max(87.5 %, length - 40 device px) of the 200 px box, clamped to its 200 px range.
  expect(top(list)).toBe(175)
  press(item, 'End')
  run(200); run(400)
  expect(top(list)).toBe(200)
  press(item, 'ArrowDown')
  run(400); run(600)
  expect(top(list)).toBe(200)
  expect(top(root)).toBe(40)
})

it('焦点在封闭 shadow root 里或自定义元素上时看不出是不是输入框，一律留给浏览器', () => {
  const root = document.documentElement
  offsets.set(root, [0, 0])
  const host = document.body.appendChild(document.createElement('div'))
  const shadow = host.attachShadow({ mode: 'closed' })
  const field = shadow.appendChild(document.createElement('input'))
  field.focus()
  expect(document.activeElement).toBe(host)
  expect(press(field, 'ArrowDown').defaultPrevented).toBe(false)
  const editor = document.body.appendChild(document.createElement('code-editor'))
  editor.tabIndex = 0
  editor.focus()
  expect(press(editor, 'PageDown').defaultPrevented).toBe(false)
  expect(frames).toHaveLength(0)
  expect(top(root)).toBe(0)
})

it('声明式封闭 shadow（不经 attachShadow）里的焦点也留给浏览器；带开放 shadow 的自定义元素自己拿着焦点时照常接管', () => {
  const root = document.documentElement
  offsets.set(root, [0, 0])
  // <template shadowrootmode="closed"> leaves no trace but this: a host that cannot take focus holds it.
  const host = document.body.appendChild(document.createElement('div'))
  const active = Object.getOwnPropertyDescriptor(Document.prototype, 'activeElement')!
  Object.defineProperty(document, 'activeElement', { configurable: true, get: () => host })
  try {
    expect(press(host, 'ArrowDown').defaultPrevented).toBe(false)
  } finally {
    Object.defineProperty(document, 'activeElement', active)
  }
  const panel = document.body.appendChild(document.createElement('side-panel'))
  panel.attachShadow({ mode: 'open' })
  panel.tabIndex = 0
  panel.focus()
  expect(press(panel, 'ArrowDown').defaultPrevented).toBe(true)
})
