/** @vitest-environment jsdom */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { UiGroup, UiPageHeader, UiToolbar } from './layout'
import { UiInput, UiTextArea } from './primitives'
import { UiModal } from './UiModal'
import Dropdown from './Dropdown'
import PanelTrigger from './PanelTrigger'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

it('横向工具栏通过有限枚举统一各动作组间距', () => {
  const { container } = render(<UiToolbar variant="command" gap="section" trailing={<span>导出</span>}>返回</UiToolbar>)
  for (const selector of ['[data-command-bar]', '[data-command-bar-leading]', '[data-command-bar-trailing]']) {
    expect(container.querySelector(selector)?.className).toContain('gap-4')
  }
})

it('两个多行原语共享高度枚举，rows 保持 DOM 属性且高度枚举不泄漏到 DOM', () => {
  const { getByLabelText } = render(<><UiTextArea aria-label="短" rows={9} /><UiTextArea aria-label="中" height="medium" /><UiTextArea aria-label="长" height="tall" /></>)
  for (const [label, height] of [['短', 'short'], ['中', 'medium'], ['长', 'tall']]) {
    expect(getByLabelText(label).className).toContain(`min-h-textarea-${height}`)
    expect(getByLabelText(label).hasAttribute('height')).toBe(false)
  }
  expect(getByLabelText('短').getAttribute('rows')).toBe('9')
})

it('面板尺寸枚举由 CSS 约束宽高，定位不写固定宽度覆盖响应式档位', () => {
  const { getByText } = render(<PanelTrigger open panelSize="compact" display="面板" renderPanel={() => <span>面板内容</span>} />)
  const panel = getByText('面板内容').closest('[data-panel-placement]') as HTMLElement
  expect(panel.className).toContain('w-[min(92vw,clamp(16rem,28vw,24rem))]')
  expect(panel.style.width).toBe('')
  expect(panel.style.maxHeight).toContain('var(--trigger-panel-max-height)')
})

it('命令带和从属带使用登记高度与相同横向留白', () => {
  const { container } = render(<UiToolbar variant="command" subordinate={<span>参数</span>}>动作</UiToolbar>)
  expect(container.querySelector('[data-command-bar]')?.className).toContain('h-band-command')
  for (const selector of ['[data-command-bar]', '[data-command-subordinate]']) {
    expect(container.querySelector(selector)?.className).toContain('px-3')
    expect(container.querySelector(selector)?.className).not.toContain('px-2.5')
  }
})

it('底座字段、紧凑组和带元信息的页头不再产生 10px 留白', () => {
  const { container } = render(<><UiInput /><UiGroup title="组" titleTone="compact" divided>内容</UiGroup><UiPageHeader title="标题" meta="数量" /></>)
  expect(container.innerHTML).not.toMatch(/(?:px|pt|gap)-2\.5/)
})

it('弹窗布局类不取消默认留白，零留白必须明确选择', () => {
  const { getByText } = render(<><UiModal scope="container" isOpen title="默认" onClose={() => undefined} contentClassName="gap-4"><span>默认正文</span></UiModal><UiModal scope="container" isOpen title="编辑" onClose={() => undefined} contentPadding="none" contentScroll="none"><span>编辑正文</span></UiModal></>)
  expect(getByText('默认正文').parentElement?.className.split(' ')).toContain('p-4')
  expect(getByText('编辑正文').parentElement?.className).toContain('p-0')
  expect(getByText('编辑正文').parentElement?.className).toContain('overflow-hidden')
})

it('Dropdown 尺寸枚举可覆盖内容测量且不受触发器宽度约束', () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  const { getByRole, getByText } = render(<Dropdown ariaLabel="选项" panelSize="wide" renderPanel={() => <span>自定义内容</span>} />)
  fireEvent.click(getByRole('button', { name: '选项' }))
  const panel = getByText('自定义内容').closest('[data-dropdown-portal]') as HTMLElement
  expect(panel.className).toContain('w-[min(92vw,clamp(24rem,48vw,45rem))]')
  expect(panel.style.width).toBe('')
})
