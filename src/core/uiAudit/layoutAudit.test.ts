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

it('弹窗打开时底下的控件不算被盖住（两个都在浮层里也一样）；同一个弹窗内部互相压着仍算', () => {
  document.body.innerHTML = `
    <div style="position: absolute; z-index: 40" data-rect="0 0 600 600">
      <button aria-label="侧栏里的" data-rect="0 0 100 30"></button>
    </div>
    <div role="dialog" data-rect="0 0 1440 900">
      <div class="scrim" data-rect="0 0 1440 900"></div>
      <button aria-label="弹窗里被盖的" data-rect="700 700 800 730"></button><div class="badge" data-rect="700 700 800 730"></div>
    </div>`
  const result = auditLayoutIssues()
  expect(result.controlOccluded.map(issue => [issue.element, issue.by])).toEqual([['button「弹窗里被盖的」', 'div.badge']])
})

it('圆形按钮的四角落在圆外：按圆角内缩取样，底下的图不算盖住它', () => {
  document.body.innerHTML = `
    <img class="cover" data-rect="0 0 200 200" />
    <button aria-label="播放" style="border-top-left-radius: 9999px; position: absolute" data-rect="80 80 120 120"></button>
    <img class="cover-2" data-rect="0 300 200 500" />
    <button aria-label="方形" style="position: absolute" data-rect="80 380 120 420"></button><div class="corner" data-rect="80 380 84 384"></div><div class="corner" data-rect="116 380 120 384"></div><div class="corner" data-rect="80 416 84 420"></div>`
  // 圆形按钮的命中范围按圆走：四角那几个像素点到的是底下的图
  const hitTest = document.elementFromPoint
  document.elementFromPoint = (x: number, y: number) => {
    const round = document.querySelector('[aria-label="播放"]') as Element
    const inside = Math.hypot(x - 100, y - 100) <= 20
    return x >= 80 && x <= 120 && y >= 80 && y <= 120 && !inside ? document.querySelector('img.cover') : hitTest.call(document, x, y) ?? round
  }
  const result = auditLayoutIssues()
  expect(result.controlOccluded.map(issue => issue.element)).toEqual(['button「方形」'])
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

it('面板行参数名的文字中线与单行控件本体中线差超过 1.5px 算不居中；多行控件不判', () => {
  document.body.innerHTML = `
    <div data-ui-form-row="panel" data-control-lines="single" data-rect="0 0 400 28"><div data-rect="0 0 96 28"><span>偏高的</span></div><div data-ui-form-control data-rect="108 0 400 28"><button role="switch" aria-label="开关一" data-rect="108 2 144 26"></button></div></div>
    <div data-ui-form-row="panel" data-control-lines="single" data-rect="0 100 400 128"><div data-rect="0 100 96 128"><span>居中的</span></div><div data-ui-form-control data-rect="108 100 400 128"><button role="switch" aria-label="开关二" data-rect="108 102 144 126"></button></div></div>
    <div data-ui-form-row="panel" data-control-lines="multiple" data-rect="0 200 400 300"><div data-rect="0 200 96 216"><span>多行的</span></div><div data-ui-form-control data-rect="108 200 400 300"><button aria-label="格子" data-rect="108 200 160 250"></button></div></div>`
  // 文字墨迹：第一行的字被顶高 6px，第二行与控件同一中线
  const ink: Record<string, [number, number]> = { 偏高的: [2, 18], 居中的: [106, 122], 多行的: [200, 216] }
  // jsdom 的 Range 没有布局方法：只在这条用例里补一个按文字查表的实现
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: function (this: Range) {
    const [top, bottom] = ink[(this.startContainer.textContent ?? '').trim()] ?? [0, 0]
    return { left: 0, right: 40, top, bottom, width: 40, height: bottom - top, x: 0, y: top, toJSON: () => ({}) } as DOMRect
  } })
  const result = auditLayoutIssues()
  delete (Range.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect
  expect(result.labelOffCenter.map(issue => [issue.element, issue.detail])).toEqual([['div「偏高的」', '文字中线比控件高 4px']])
})

it('浮层离触发器超过 12px 或触发器中线落在浮层外算脱离；贴着的不算', () => {
  document.body.innerHTML = `
    <div role="menu" aria-label="贴着的" data-anchor-rect="100,100,80,32" data-rect="60 140 260 300"></div>
    <div role="menu" aria-label="离得远的" data-anchor-rect="400,400,80,32" data-rect="360 345 560 355"></div>
    <div role="menu" aria-label="错开的" data-anchor-rect="700,100,80,32" data-rect="800 140 1000 300"></div>`
  const result = auditLayoutIssues()
  expect(result.popoverDetached.map(issue => [issue.element, issue.detail])).toEqual([['div「离得远的」', '离触发器 45px'], ['div「错开的」', '触发器中线落在浮层外']])
})

it('同组静息图标按钮颜色不一时报少数的那个；开着的、不可用的、写明理由的组不算', () => {
  document.body.innerHTML = `
    <div class="tools">${['a', 'b', 'c'].map(name => `<button class="ui-btn" data-tone="rest" aria-label="${name}" style="color: rgb(100, 100, 100)" data-rect="0 0 28 28"><svg></svg></button>`).join('')}<button class="ui-btn" data-tone="danger" aria-label="删除" style="color: rgb(200, 200, 200)" data-rect="0 0 28 28"><svg></svg></button></div>
    <div class="tools-on">${['d', 'e', 'f'].map(name => `<button class="ui-btn" data-tone="rest" aria-label="${name}" style="color: rgb(100, 100, 100)" data-rect="0 100 28 128"><svg></svg></button>`).join('')}<button class="ui-btn ui-btn-rest-on" data-tone="rest" aria-label="开着的" style="color: rgb(240, 240, 240)" data-rect="0 100 28 128"><svg></svg></button><button class="ui-btn" data-tone="rest" aria-disabled="true" aria-label="不可用的" style="color: rgb(60, 60, 60)" data-rect="0 100 28 128"><svg></svg></button></div>
    <div data-layout-allow="tone" data-layout-allow-reason="动作与默认开关分两档">${['g', 'h', 'i'].map(name => `<button class="ui-btn" data-tone="rest" aria-label="${name}" style="color: rgb(100, 100, 100)" data-rect="0 200 28 228"><svg></svg></button>`).join('')}<button class="ui-btn" data-tone="default" aria-label="动作" style="color: rgb(200, 200, 200)" data-rect="0 200 28 228"><svg></svg></button></div>`
  const result = auditLayoutIssues()
  expect(result.iconToneMismatch.map(issue => issue.element)).toEqual(['button.ui-btn「删除」'])
})
