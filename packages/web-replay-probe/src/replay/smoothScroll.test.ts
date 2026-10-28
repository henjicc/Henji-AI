/** @vitest-environment jsdom */
import { beforeAll, expect, it, vi } from 'vitest'
import { installSmoothScroll } from './smoothScroll'

// The browser's scroll primitives, on a map: jsdom has no layout or scrolling.
let now = 0
const frames: FrameRequestCallback[] = []
const offsets = new WeakMap<Element, { left: number; top: number }>()
const at = (el: Element): { left: number; top: number } => { let o = offsets.get(el); if (!o) offsets.set(el, o = { left: 0, top: 0 }); return o }
/** Where the browser's instant scrollIntoView of an element would scroll, and to which top. */
const intoView = new Map<Element, [Element, number]>()
const run = (t: number): void => { now = t; for (const callback of frames.splice(0)) callback(t) }

beforeAll(() => {
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  ;(globalThis as Record<string, unknown>).requestAnimationFrame = (callback: FrameRequestCallback) => frames.push(callback)
  const proto = Element.prototype as unknown as Record<string, unknown>
  const scrollTo = function (this: Element, options: ScrollToOptions) { if (options.left !== undefined) at(this).left = options.left; if (options.top !== undefined) at(this).top = options.top }
  Object.assign(proto, { scrollTo, scrollBy: scrollTo, scrollIntoView(this: Element) { const hit = intoView.get(this); if (hit) at(hit[0]).top = hit[1] } })
  Object.defineProperty(Element.prototype, 'scrollTop', { configurable: true, get(this: Element) { return at(this).top }, set(this: Element, value: number) { at(this).top = value } })
  Object.defineProperty(Element.prototype, 'scrollLeft', { configurable: true, get(this: Element) { return at(this).left }, set(this: Element, value: number) { at(this).left = value } })
  installSmoothScroll()
})

it('CSS 设了 smooth 时直接给 scrollTop 赋值，也在页面时间上滚过去；没设的立即到位', async () => {
  const smooth = document.body.appendChild(document.createElement('div'))
  smooth.style.scrollBehavior = 'smooth'
  const plain = document.body.appendChild(document.createElement('div'))
  now = 0
  smooth.scrollTop = 300
  plain.scrollTop = 300
  expect(plain.scrollTop).toBe(300)
  expect(smooth.scrollTop).toBe(0)
  run(0)
  await new Promise(resolve => setTimeout(resolve, 60))
  run(0)
  expect(smooth.scrollTop).toBe(0)
  // min(sqrt(300), 12) / 60 s = 200 ms, ease-in-out: halfway at 100 ms.
  run(100)
  expect(smooth.scrollTop).toBeCloseTo(150, 0)
  run(200)
  expect(smooth.scrollTop).toBe(300)
  expect(frames).toHaveLength(0)
})

it('shadow 树里的元素 scrollIntoView 平滑滚动时，跨过 shadow 宿主带动外层滚动框，也在页面时间上走', () => {
  const outer = document.body.appendChild(document.createElement('div'))
  const host = outer.appendChild(document.createElement('div'))
  const inner = host.attachShadow({ mode: 'open' }).appendChild(document.createElement('div'))
  intoView.set(inner, [outer, 300])
  now = 1000
  inner.scrollIntoView({ behavior: 'smooth' })
  expect(outer.scrollTop).toBe(0)
  run(1000)
  run(1100)
  expect(outer.scrollTop).toBeCloseTo(150, 0)
  run(1200)
  expect(outer.scrollTop).toBe(300)
})
