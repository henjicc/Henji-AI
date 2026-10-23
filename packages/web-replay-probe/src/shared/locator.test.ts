/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { describeElementAt, resolveLocator } from './locator'

// jsdom has no layout: give every element a box and let tests choose what is on top.
let onTop: Element | null = null
// jsdom lacks CSS.escape; every real WebView has it.
if (!globalThis.CSS?.escape) Object.assign(globalThis, { CSS: { escape: (v: string) => v.replace(/["\\]/g, '\\$&') } })
beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20, toJSON: () => ({}) } as DOMRect)
  document.elementFromPoint = (() => onTop) as typeof document.elementFromPoint
})
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; onTop = null })

const node = (id: string): string => `<div data-replay-id="node-${id}"><p>正文 ${id}</p><button data-act="detail" aria-label="查看详情">详</button></div>`

describe('locator', () => {
  it('records the action inside an identified container, scoped by that container', () => {
    document.body.innerHTML = node('1') + node('2')
    const button = document.querySelectorAll('[data-act="detail"]')[1]
    const info = describeElementAt(button, 10, 10)!
    expect(info.locator).toMatchObject({ act: { name: 'detail', scope: 'node-2' }, name: '查看详情' })
    expect(info.locator.replayId).toBeUndefined()
    expect(resolveLocator(info.locator)).toBe(button)
  })

  it('still names the container when the click lands on it directly', () => {
    document.body.innerHTML = node('1')
    const text = document.querySelector('p')!
    expect(describeElementAt(text, 5, 5)!.locator.replayId).toBe('node-1')
  })

  it('picks the duplicate that is actually on top', () => {
    document.body.innerHTML = '<ul><li data-replay-id="history-a">首页</li></ul><aside><li data-replay-id="history-a">面板</li></aside>'
    const [, panel] = document.querySelectorAll('[data-replay-id="history-a"]')
    onTop = panel
    expect(resolveLocator({ replayId: 'history-a', tag: 'li', path: '' })).toBe(panel)
    onTop = null
    expect(resolveLocator({ replayId: 'history-a', tag: 'li', path: '' })).toBe(document.querySelector('ul li'))
  })
})
