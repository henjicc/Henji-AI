/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { Plus, Trash2 } from 'lucide-react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { UiToolbar, type UiPanelFooterTool } from './layout'

const TOOL_WIDTH = 28
const STATUS_FLOOR = 64
let footerWidth = 300
const observers: Array<() => void> = []

// jsdom 不排版：按 flex 的实际结果给出宽度——工具行取内容宽度、被压时只剩“底栏 − 状态下限”，状态分剩余宽度但不小于下限。
function rowContentWidth(row: Element): number {
  return row.querySelectorAll('[data-overflow-item], [data-overflow-menu]').length * TOOL_WIDTH
}
function widthOf(element: Element): number {
  if (element.hasAttribute('data-panel-footer')) return footerWidth
  if (element.hasAttribute('data-ui-overflow-row')) return Math.min(rowContentWidth(element), footerWidth - STATUS_FLOOR)
  if (element.hasAttribute('data-panel-footer-status')) {
    const row = element.parentElement?.querySelector('[data-ui-overflow-row]')
    return Math.max(STATUS_FLOOR, footerWidth - (row ? rowContentWidth(row) : 0))
  }
  if (element.hasAttribute('data-overflow-item') || element.hasAttribute('data-overflow-menu')) return TOOL_WIDTH
  return 0
}

beforeEach(() => {
  footerWidth = 300
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const width = widthOf(this)
    return { width, height: 0, x: 0, y: 0, top: 0, left: 0, right: width, bottom: 0, toJSON: () => ({}) } as DOMRect
  })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) { return widthOf(this) })
  const computed = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element: Element) => {
    const style = computed(element)
    if (!element.hasAttribute('data-panel-footer-status')) return style
    return new Proxy(style, { get: (target, key) => key === 'minWidth' ? `${STATUS_FLOOR}px` : (value => typeof value === 'function' ? value.bind(target) : value)(Reflect.get(target, key)) })
  })
  vi.stubGlobal('ResizeObserver', class { constructor(private readonly callback: () => void) { observers.push(() => this.callback()) } observe(): void {} disconnect(): void {} })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
})
afterEach(() => { cleanup(); observers.length = 0; vi.restoreAllMocks(); vi.unstubAllGlobals() })

function resizeFooter(width: number): void {
  footerWidth = width
  act(() => { for (const notify of [...observers]) notify() })
}
const visibleTools = (): string[] => Array.from(document.querySelectorAll('[data-overflow-item]')).map(element => element.getAttribute('data-overflow-item') ?? '')

it('底栏变窄时状态先截到下限，工具从右往左收进“更多”；变宽后放回；收起的工具在菜单里有名称、能执行、禁用原因照旧', () => {
  const create = vi.fn()
  const tools: UiPanelFooterTool[] = [
    { kind: 'action', id: 'a', label: '视图', icon: Plus, onSelect: vi.fn() },
    { kind: 'action', id: 'b', label: '链接', icon: Plus, onSelect: vi.fn() },
    { kind: 'action', id: 'remove', label: '删除选中项', icon: Trash2, disabled: true, disabledReason: '先选中一项', onSelect: vi.fn() },
    { kind: 'action', id: 'create', label: '新建', icon: Plus, onSelect: create },
  ]
  render(<UiToolbar variant="footer" aria-label="面板底栏" tools={tools}>8 项 · 已选 1</UiToolbar>)
  expect(visibleTools()).toEqual(['a', 'b', 'remove', 'create'])

  // 120 宽：状态只剩 64 下限，工具行 56 = 一个工具 + “更多”
  resizeFooter(120)
  expect(visibleTools()).toEqual(['a'])
  fireEvent.click(screen.getByRole('button', { name: '更多工具' }))
  const menu = within(screen.getByRole('menu', { name: '更多工具' }))
  expect(menu.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['链接', '删除选中项', '新建'])
  const blocked = menu.getByRole('menuitem', { name: '删除选中项' })
  expect(blocked.getAttribute('aria-disabled')).toBe('true')
  fireEvent.focus(blocked)
  expect(screen.getByRole('tooltip').textContent).toBe('先选中一项')
  fireEvent.click(menu.getByRole('menuitem', { name: '新建' }))
  expect(create).toHaveBeenCalledTimes(1)

  // 变宽：工具行此时只有内容宽度，靠状态超出下限的部分才知道放得下
  resizeFooter(300)
  expect(visibleTools()).toEqual(['a', 'b', 'remove', 'create'])
  expect(screen.queryByRole('button', { name: '更多工具' })).toBeNull()
})

it('焦点停在被收起的工具上时转到“更多”；收起后菜单里保留危险色与勾选', () => {
  const tools: UiPanelFooterTool[] = [
    { kind: 'action', id: 'a', label: '视图', icon: Plus, onSelect: vi.fn() },
    { kind: 'action', id: 'master', label: '停用所有效果', icon: Plus, pressed: true, onSelect: vi.fn() },
    { kind: 'action', id: 'remove', label: '删除选中项', icon: Trash2, tone: 'danger', onSelect: vi.fn() },
  ]
  render(<UiToolbar variant="footer" aria-label="面板底栏" tools={tools}>8 项</UiToolbar>)
  expect(screen.getByRole('button', { name: '停用所有效果' }).getAttribute('aria-pressed')).toBe('true')
  screen.getByRole('button', { name: '删除选中项' }).focus()
  resizeFooter(120)
  expect(visibleTools()).toEqual(['a'])
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '更多工具' }))
  fireEvent.click(screen.getByRole('button', { name: '更多工具' }))
  const menu = within(screen.getByRole('menu', { name: '更多工具' }))
  expect(menu.getByRole('menuitemcheckbox', { name: '停用所有效果' }).getAttribute('aria-checked')).toBe('true')
  expect(menu.getByText('删除选中项').closest('.text-danger-text')).not.toBeNull()
})

it('面板自己的低频操作放进同一个“更多”，收起的工具排在前面，不出现第二个“更多”', () => {
  const tools: UiPanelFooterTool[] = [
    { kind: 'action', id: 'a', label: '确认', icon: Plus, onSelect: vi.fn() },
    { kind: 'action', id: 'b', label: '驳回', icon: Plus, onSelect: vi.fn() },
  ]
  render(<UiToolbar variant="footer" aria-label="批注工具" tools={tools} more={<span role="menuitem">导出批注</span>} moreLabel="更多批注操作">3 条</UiToolbar>)
  expect(screen.getAllByRole('button', { name: '更多批注操作' })).toHaveLength(1)
  resizeFooter(120)
  expect(visibleTools()).toEqual(['a'])
  expect(screen.getAllByRole('button', { name: '更多批注操作' })).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: '更多批注操作' }))
  expect(within(screen.getByRole('menu', { name: '更多批注操作' })).getAllByRole('menuitem').map(item => item.textContent)).toEqual(['驳回', '导出批注'])
})
