// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import i18n from '@/i18n/config'
import { GenerationHistoryToolbar, type GenerationHistoryToolbarProps } from './GenerationHistoryToolbar'

beforeEach(async () => {
  await i18n.changeLanguage('zh-CN')
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function setup(overrides: Partial<GenerationHistoryToolbarProps> = {}) {
  const props: GenerationHistoryToolbarProps = {
    mediaType: 'all',
    mediaOptions: [
      { value: 'all', label: '全部' },
      { value: 'image', label: '图片' },
      { value: 'video', label: '视频' },
    ],
    onMediaTypeChange: vi.fn(),
    searchOpen: false,
    onToggleSearch: vi.fn(),
    hasActiveFilters: false,
    matchedCount: 3,
    totalCount: 10,
    onOpenClearHistory: vi.fn(),
    ...overrides,
  }
  render(<GenerationHistoryToolbar {...props} />)
  return props
}

it('类型分段是单选组，当前项 aria-checked，点选切换筛选', () => {
  const props = setup({ mediaType: 'image' })
  const group = screen.getByRole('radiogroup', { name: '筛选类型' })
  expect(group).toBeTruthy()
  expect(screen.getByRole('radio', { name: '图片' }).getAttribute('aria-checked')).toBe('true')
  fireEvent.click(screen.getByRole('radio', { name: '视频' }))
  expect(props.onMediaTypeChange).toHaveBeenCalledWith('video')
})

it('搜索按钮是开关，搜索展开或筛选生效时显示命中数，都不满足时不显示', () => {
  const props = setup({ searchOpen: true })
  const search = screen.getByRole('button', { name: '搜索历史' })
  expect(search.getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(search)
  expect(props.onToggleSearch).toHaveBeenCalledTimes(1)
  expect(screen.getByText('显示 3 / 10 条')).toBeTruthy()
  cleanup()
  setup({ searchOpen: false, hasActiveFilters: true })
  expect(screen.getByRole('button', { name: '搜索历史' }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByRole('button', { name: '搜索历史' }).getAttribute('aria-expanded')).toBe('false')
  expect(screen.getByText('显示 3 / 10 条')).toBeTruthy()
  cleanup()
  setup({ searchOpen: false })
  expect(screen.queryByText(/显示 \d+ \/ \d+ 条/)).toBeNull()
})

it('清除历史收进“更多”菜单，且是危险档动作', () => {
  const props = setup()
  expect(screen.queryByText('清除历史')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '更多操作' }))
  const clear = screen.getByRole('button', { name: '清除历史' })
  expect(clear.getAttribute('data-variant')).toBe('danger')
  fireEvent.click(clear)
  expect(props.onOpenClearHistory).toHaveBeenCalledTimes(1)
})
