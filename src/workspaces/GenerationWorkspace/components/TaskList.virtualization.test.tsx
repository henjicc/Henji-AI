// @vitest-environment jsdom
import React, { useContext, useRef } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TaskList, type TaskListProps } from './TaskList'
import { TaskListRetentionContext, type TaskListRetention } from '../hooks/useTaskListRetention'
import type { GenerationTask } from '../types'
import { revealGenerationTask } from '../application/generationTaskNavigation'

vi.mock('@/hooks/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/components/ui', () => ({
  UiRegion: ({ children }: React.PropsWithChildren) => <section>{children}</section>,
  UiPageHeader: () => <div>历史</div>, UiEmpty: () => <div>空</div>,
}))
let retainedState: TaskListRetention | null = null
const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo')
vi.mock('./TaskCard', () => ({ default: function MockTaskCard({ task }: { task: GenerationTask }) {
  const retention = useContext(TaskListRetentionContext)
  retainedState = retention
  return <div data-generation-task-id={task.id}>
    {React.createElement('button', { type: 'button' }, task.id)}
    <audio src={`media:${task.id}`} />
  </div>
} }))

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-index') ? 240 : 600
  })
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1000)
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(4000000)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    return { x: 0, y: 0, top: 0, left: 0, bottom: 600, right: 1000, width: 1000, height: 600, toJSON: () => ({}) }
  })
  HTMLElement.prototype.scrollTo = function (options?: ScrollToOptions | number) {
    if (typeof options === 'object') this.scrollTop = options.top ?? this.scrollTop
  }
})
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); retainedState = null
  if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo)
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo')
})

function tasks(count: number): GenerationTask[] {
  return Array.from({ length: count }, (_, i) => ({ id: `task-${i}`, createdAt: new Date(), type: 'image', prompt: '', model: 'fixture', status: 'success' }))
}
const callbacks = {
  showMenu: vi.fn(), onDownload: vi.fn(), onCopyImage: vi.fn(), onRegenerate: vi.fn(), onRetryPolling: vi.fn(),
  onReedit: vi.fn(), onDelete: vi.fn(), onUsePrompt: vi.fn(), onRememberResultImageDimensions: vi.fn(),
  onOpenImageViewer: vi.fn(), onOpenVideoViewer: vi.fn(), notify: vi.fn(),
} satisfies Omit<TaskListProps, 'scrollContainerRef' | 'tasks' | 'totalCount' | 'matchedCount' | 'hasActiveFilters'>
function Fixture({ items }: { items: GenerationTask[] }) {
  const ref = useRef<HTMLDivElement>(null)
  return <div ref={ref} data-testid="scroll"><TaskList {...callbacks} scrollContainerRef={ref} tasks={items} totalCount={items.length} matchedCount={items.length} hasActiveFilters={false} /></div>
}
const card = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`[data-generation-task-id="${id}"]`)
function scroll(element: HTMLElement, top: number) { act(() => { element.scrollTop = top; fireEvent.scroll(element) }) }

it('万条任务只挂载视口及少量预读卡片，滚动更换内容而非累积挂载', () => {
  const view = render(<Fixture items={tasks(10000)} />)
  const count = () => view.container.querySelectorAll('[data-generation-task-id]').length
  expect(card(view.container, 'task-0')).not.toBeNull()
  expect(count()).toBeGreaterThan(0)
  expect(count()).toBeLessThan(20)
  for (const top of [30000, 60000, 90000]) {
    scroll(view.getByTestId('scroll'), top)
    expect(card(view.container, 'task-0')).toBeNull()
    expect(count()).toBeLessThan(20)
  }
})

it('通过正式定位入口显示原本未挂载的历史任务，卸载后移除定位回调', () => {
  const view = render(<Fixture items={tasks(10000)} />)
  expect(card(view.container, 'task-9000')).toBeNull()
  act(() => {
    revealGenerationTask('task-9000')
    fireEvent.scroll(view.getByTestId('scroll'))
  })
  expect(card(view.container, 'task-9000')).not.toBeNull()
  const scrollElement = view.getByTestId('scroll')
  const previous = scrollElement.scrollTop
  view.unmount()
  revealGenerationTask('task-0')
  expect(scrollElement.scrollTop).toBe(previous)
})

it('滚出视口后保留焦点及相邻键盘目标，失焦后释放卡片', () => {
  const view = render(<Fixture items={tasks(10000)} />)
  const focused = card(view.container, 'task-0')!.querySelector('button')!
  act(() => focused.focus())
  scroll(view.getByTestId('scroll'), 90000)
  expect(document.activeElement).toBe(focused)
  expect(card(view.container, 'task-1')).not.toBeNull()
  expect(view.container.querySelectorAll('[data-generation-task-id]').length).toBeLessThan(25)
  act(() => focused.blur())
  expect(card(view.container, 'task-0')).toBeNull()
})

it('活动媒体保留同一元素，释放后记录暂停状态；删除清理状态且不能复活任务', () => {
  const items = tasks(1000)
  const view = render(<Fixture items={items} />)
  const audio = card(view.container, 'task-0')!.querySelector('audio')!
  act(() => retainedState!.setActive('task-0', 'audio', true))
  scroll(view.getByTestId('scroll'), 30000)
  expect(card(view.container, 'task-0')!.querySelector('audio')).toBe(audio)
  audio.currentTime = 23
  audio.volume = 0.35
  act(() => retainedState!.setActive('task-0', 'audio', false))
  expect(card(view.container, 'task-0')).toBeNull()
  expect(retainedState!.getAudio('task-0', 'media:task-0')).toEqual({ currentTime: 23, volume: 0.35 })
  expect(retainedState!.getAudio('task-0', 'media:different')).toBeUndefined()
  view.rerender(<Fixture items={items.slice(1)} />)
  expect(retainedState!.getAudio('task-0', 'media:task-0')).toBeUndefined()
})
