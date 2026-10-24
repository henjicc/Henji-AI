// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { auditLayoutIssues } from './layoutAudit'

/** jsdom 没有布局：外框写在 data-rect="left top right bottom"，命中测试按“外框包含该点的最后一个元素”模拟层叠。 */
const rectOf = (element: Element): DOMRect => {
  const [left, top, right, bottom] = (element.getAttribute('data-rect') ?? '0 0 0 0').split(' ').map(Number)
  return { left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) } as DOMRect
}
beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) { return this.hasAttribute('data-rect') ? rectOf(this) : { left: 0, top: 0, right: 1440, bottom: 900, width: 1440, height: 900, x: 0, y: 0, toJSON: () => ({}) } as DOMRect })
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 })
  document.elementFromPoint = (x: number, y: number) => {
    const hits = [...document.querySelectorAll('[data-rect]')].filter(element => { const rect = rectOf(element); return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom && getComputedStyle(element).pointerEvents !== 'none' })
    return hits.at(-1) ?? document.body
  }
})
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = '' })

it('不滚动的容器裁掉控件一截算裁切；滚动容器、整块看不见、有理由的声明不算', () => {
  document.body.innerHTML = `
    <div style="overflow-x: hidden; overflow-y: hidden" data-rect="0 0 100 40">
      <button aria-label="被裁的按钮" data-rect="80 10 140 30"></button>
      <button aria-label="整块移出" data-rect="200 10 260 30"></button>
    </div>
    <div style="overflow-x: auto; overflow-y: hidden" data-rect="0 100 100 140"><button aria-label="滚动里的按钮" data-rect="80 110 140 130"></button></div>
    <div style="overflow-x: hidden; overflow-y: hidden" data-rect="0 200 100 240" data-layout-allow="clip" data-layout-allow-reason="跑马灯文字"><button aria-label="声明过的" data-rect="80 210 140 230"></button></div>
    <div style="overflow-x: hidden; overflow-y: hidden" data-rect="0 300 100 340" data-layout-allow="clip"><button aria-label="没写理由" data-rect="80 310 140 330"></button></div>`
  const result = auditLayoutIssues()
  expect(result.controlClipped.map(issue => issue.element)).toEqual(['button「被裁的按钮」', 'button「没写理由」'])
  expect(result.controlClipped[0]).toMatchObject({ detail: 'x 方向裁掉 40px', by: 'div' })
})

it('绝对定位的控件只受包含块裁切；文字被纵向裁掉也算', () => {
  document.body.innerHTML = `
    <div style="position: relative" data-rect="0 0 400 400">
      <div style="overflow-x: hidden; overflow-y: hidden" data-rect="0 0 100 40"><button style="position: absolute" aria-label="浮出去的" data-rect="80 10 140 30"></button></div>
    </div>
    <div style="overflow-x: hidden; overflow-y: hidden" data-rect="0 500 300 520"><span data-rect="0 505 200 530">被截掉下半的标题</span></div>`
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', { configurable: true, get(this: HTMLElement) { return this.parentElement?.parentElement ?? null } })
  const result = auditLayoutIssues()
  expect(result.controlClipped.map(issue => issue.element)).toEqual(['span「被截掉下半的标题」'])
  expect(result.controlClipped[0].detail).toBe('y 方向裁掉 10px')
})

it('控件中心被别的元素盖住算遮挡；盖在上面的是浮层、吸顶行或分隔条时不算', () => {
  document.body.innerHTML = `
    <button aria-label="被盖住的" data-rect="0 0 100 30"></button><div class="cover" data-rect="0 0 100 30"></div>
    <button aria-label="菜单下面的" data-rect="0 100 100 130"></button><div role="menu" data-rect="0 100 100 130"></div>
    <button aria-label="吸顶行下面的" data-rect="0 200 100 230"></button><div style="position: sticky" data-rect="0 200 100 230"></div>
    <button aria-label="边上压着分隔条" data-rect="0 300 100 330"></button><div role="separator" data-rect="96 300 100 330"></div>
    <button aria-label="正常的" data-rect="0 400 100 430"></button>`
  const result = auditLayoutIssues()
  expect(result.controlOccluded.map(issue => [issue.element, issue.by, issue.detail])).toEqual([['button「被盖住的」', 'div.cover', '5/5 个取样点被盖住']])
  expect(result.controlClipped).toEqual([])
})

it('运行时守卫可取回问题对应的元素', () => {
  document.body.innerHTML = `<div style="overflow-x: hidden; overflow-y: hidden" data-rect="0 0 100 40"><button aria-label="被裁的按钮" data-rect="80 10 140 30"></button></div>`
  const result = auditLayoutIssues({ collectElements: true })
  expect(result.targets?.map(target => target.element.getAttribute('aria-label'))).toEqual(['被裁的按钮'])
})

it('省略号截断不算裁切；滚动容器里伸出去的部分按可见范围取样，不当成被邻居盖住；角上压着小部件不算遮挡', () => {
  document.body.innerHTML = `
    <div style="overflow-x: hidden; overflow-y: hidden; text-overflow: ellipsis" data-rect="0 0 100 20"><span data-rect="0 0 200 20">很长的标题需要截断</span></div>
    <div style="overflow-x: auto; overflow-y: auto" data-rect="0 100 100 140"><button aria-label="列表里的宽行" data-rect="0 110 300 130"></button></div><div class="neighbor" data-rect="100 100 400 140"></div>
    <button aria-label="角上有手柄" data-rect="0 200 100 230"></button><div class="handle-a" data-rect="0 200 6 206"></div><div class="handle-b" data-rect="94 200 100 206"></div>`
  const result = auditLayoutIssues()
  expect(result.controlClipped).toEqual([])
  expect(result.controlOccluded).toEqual([])
})
