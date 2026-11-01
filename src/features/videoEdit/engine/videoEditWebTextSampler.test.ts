// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TEXT_GEOMETRY_PREPARE_SCRIPT, textGeometryPaintSetup } from '../../../../electron/main/services/web-source/textGeometry'
import type { WebTextCapture } from '@/core/videoEdit/webTextGeometry'

interface Sampling {
  sampleText(): WebTextCapture
  textSyncReasons(): string[]
}
let stage: HTMLElement
let container: HTMLElement
let animations: Map<Element, { playState: string }[]>
let fonts: { status: string; ready: Promise<void>; addEventListener: ReturnType<typeof vi.fn>; [Symbol.iterator](): ArrayIterator<{ status: string }> }

beforeEach(async () => {
  document.body.innerHTML = '<canvas><div data-henji-stage></div></canvas>'
  stage = document.querySelector('[data-henji-stage]')!
  container = stage.parentElement!
  animations = new Map()
  fonts = { status: 'loaded', ready: Promise.resolve(), addEventListener: vi.fn(), [Symbol.iterator]: () => [][Symbol.iterator]() }
  Object.defineProperty(document, 'fonts', { configurable: true, value: fonts })
  const computed = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
    if (pseudo) return { content: 'none' } as CSSStyleDeclaration
    const style = computed(element)
    return new Proxy(style, { get: (target, key) => key === 'opacity' ? target.opacity || '1' : key === 'transform' ? target.transform || 'none' : typeof key === 'string' && /^(padding|border)/.test(key) ? '0px' : Reflect.get(target, key) })
  })
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, 100, 100))
  Object.defineProperty(Element.prototype, 'getAnimations', { configurable: true, value: function (this: Element) { return animations.get(this) ?? [] } })
  vi.spyOn(document, 'createRange').mockImplementation(() => {
    let node: Text, start = 0, end = 0
    return {
      selectNodeContents(value: Text) { node = value; start = 0; end = value.length },
      setStart(value: Text, offset: number) { node = value; start = offset },
      setEnd(_value: Text, offset: number) { end = offset },
      getClientRects() {
        const raw = node.data.slice(start, end), parent = node.parentElement!
        const width = /^[\s\u200b]+$/u.test(raw) ? 0 : (end - start) * 10
        return [new DOMRect(Number(parent.dataset.x ?? 0) + start * 10, 0, width, 20)]
      },
    } as unknown as Range
  })
  await new Function(`return ${TEXT_GEOMETRY_PREPARE_SCRIPT}`)()
})
afterEach(() => { vi.restoreAllMocks(); delete (window as unknown as Record<string, unknown>).__henjiWebText })

function setup(html: string, selectors = ['#title'], trace = false): Sampling {
  stage.innerHTML = html
  return new Function('stage', 'container', `${textGeometryPaintSetup(selectors, [0, 0, 100, 100], trace)}; return {sampleText,textSyncReasons}`)(stage, container) as Sampling
}

it('保留跨 inline Unicode 来源，并分开换行、块、语言与替换元素边界', () => {
  const sampling = setup('<div id="title"><span>e</span><span>́</span><br>甲<div>乙</div><span lang="en">A</span><img>B</div>')
  const result = sampling.sampleText().results['#title']
  expect(result.status).toBe('ready')
  if (result.status !== 'ready') throw new Error('missing geometry')
  const { geometry } = result
  expect(geometry.text).toBe('é甲乙AB')
  expect(geometry.graphemes[0].segments).toHaveLength(2)
  expect(geometry.graphemes[0].source).toEqual({ start: 0, end: 2 })
  expect(geometry.breaks).toEqual(expect.arrayContaining([
    { offset: 2, kind: 'line-break' }, { offset: 3, kind: 'block' },
    { offset: 4, kind: 'language' }, { offset: 5, kind: 'replaced-element' },
  ]))
})

it('分别保存零宽位置、折叠空白、隐藏、透明和取景外状态', () => {
  const sampling = setup('<div id="title"><span>\u200b</span><span> </span><span style="display:none">隐</span><span style="visibility:hidden">藏</span><span style="opacity:0">透</span><span data-x="200">外</span></div>')
  const result = sampling.sampleText().results['#title']
  if (result.status !== 'ready') throw new Error('missing geometry')
  const [zero, space, hidden, invisible, transparent, outside] = result.geometry.graphemes
  expect(zero).toMatchObject({ layoutStatus: 'zero-width', bounds: [0, 0, 0, 20], rendered: false })
  expect(space.layoutStatus).toBe('collapsed-whitespace')
  expect(hidden).toMatchObject({ layoutStatus: 'display-none', rects: [], bounds: null })
  expect(invisible.layoutStatus).toBe('visibility-hidden')
  expect(transparent).toMatchObject({ layoutStatus: 'box', transparent: true, rendered: false })
  expect(outside).toMatchObject({ layoutStatus: 'box', outsideRegion: true, regionRects: [], rendered: false })
})

it('零宽不换行空格和保留换行不按 CSS 折叠空白分类', () => {
  const sampling = setup('<div id="title"><span>\ufeff</span><br><span style="white-space:pre">\n</span></div>')
  const result = sampling.sampleText().results['#title']
  if (result.status !== 'ready') throw new Error('missing geometry')
  expect(result.geometry.graphemes.map(g=>g.layoutStatus)).toEqual(['zero-width', 'zero-width'])
})

it('跨 inline 字素按贡献片段联合判断透明度与取景，不拼出不存在的可见文字', () => {
  const sampling = setup('<div id="title"><span style="display:none">e</span><span style="opacity:0">́</span><br><span data-x="200">a</span><span style="opacity:0">́</span></div>')
  const result = sampling.sampleText().results['#title']
  if (result.status !== 'ready') throw new Error('missing geometry')
  expect(result.geometry.graphemes[0]).toMatchObject({ transparent: true, rendered: false })
  expect(result.geometry.graphemes[1]).toMatchObject({ transparent: false, rendered: false })
})

it('只对所选子树和祖先核对动画与滚动，逐项报告同步失败原因', () => {
  const sampling = setup('<div id="title"><span>A</span></div><aside>其他内容</aside>')
  const title = stage.querySelector('#title')!, sibling = stage.querySelector('aside')!
  animations.set(sibling, [{ playState: 'running' }])
  sibling.scrollTop = 10
  expect(sampling.textSyncReasons()).toEqual([])
  animations.set(title, [{ playState: 'running' }])
  title.scrollTop = 4
  fonts.status = 'loading'
  expect(sampling.textSyncReasons()).toEqual(['subtree-scroll', 'font-loading', 'running-animation'])
})

it('正常取帧不额外序列化大 DTO，trace 才统计字节', () => {
  const normal = setup('<div id="title">标题</div>')
  const encode = vi.spyOn(TextEncoder.prototype, 'encode')
  expect(normal.sampleText()).toMatchObject({ bytes: 0, serializationMs: 0 })
  expect(encode).not.toHaveBeenCalled()
  const trace = setup('<div id="title">标题</div>', ['#title'], true)
  expect(trace.sampleText().bytes).toBeGreaterThan(0)
  expect(encode).toHaveBeenCalledOnce()
})
