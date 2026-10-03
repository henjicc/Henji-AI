/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import zhUi from '@/i18n/locales/zh-CN/ui.json'
import WindowControls from './WindowControls'

const windowApi = vi.hoisted(() => ({
  isMaximized: vi.fn(async () => false),
  onResized: vi.fn(() => () => undefined),
  minimize: vi.fn(async () => undefined),
  toggleMaximize: vi.fn(async () => undefined),
  close: vi.fn(async () => undefined),
}))

function translate(key: string): string {
  const value = key.split('.').reduce<unknown>(
    (node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
    zhUi,
  )
  return typeof value === 'string' ? value : key
}

vi.mock('@/hooks/useI18n', () => ({ useI18n: () => ({ t: translate }) }))
vi.mock('@/platform/runtime', () => ({
  isDesktopRuntime: () => true,
  getPlatform: () => ({ window: windowApi }),
}))

afterEach(cleanup)

async function renderTitleBar(props: Parameters<typeof WindowControls>[0] = {}) {
  const view = render(<WindowControls {...props} />)
  await act(async () => undefined)
  return view
}

describe('应用标题栏（任务 3.1，设计稿 TitleBar）', () => {
  it('纯文字工作区导航，“工具箱”改名为“工具”，当前工作区标 aria-current', async () => {
    const onTabChange = vi.fn()
    await renderTitleBar({ activeTab: 'tools', onTabChange })

    const nav = screen.getByRole('navigation', { name: '工作区' })
    const names = Array.from(nav.querySelectorAll('button')).map((button) => button.textContent)
    expect(names).toEqual(['生成', '画布', '剪辑', '工具', '资产'])
    expect(nav.querySelector('svg')).toBeNull()

    const tools = screen.getByRole('button', { name: '工具' })
    expect(tools.getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('button', { name: '生成' }).getAttribute('aria-current')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '画布' }))
    expect(onTabChange).toHaveBeenCalledWith('nodes')
  })

  it('资产浮动面板是开关（aria-pressed），aria-current 只给当前工作区；资产完整工作区才是当前页', async () => {
    const onAssetClick = vi.fn()
    const view = await renderTitleBar({ activeTab: 'generation', assetView: 'floating', onAssetClick })
    const assets = screen.getByRole('button', { name: '资产' })
    expect(assets.getAttribute('aria-pressed')).toBe('true')
    expect(assets.getAttribute('aria-current')).toBeNull()
    expect(screen.getByRole('button', { name: '生成' }).getAttribute('aria-current')).toBe('page')
    expect(view.container.querySelectorAll('[aria-current="page"]')).toHaveLength(1)
    fireEvent.click(assets)
    expect(onAssetClick).toHaveBeenCalledTimes(1)

    view.rerender(<WindowControls activeTab="generation" assetView="closed" />)
    expect(screen.getByRole('button', { name: '资产' }).getAttribute('aria-pressed')).toBe('false')

    view.rerender(<WindowControls activeTab="assets" assetView="workspace" />)
    const workspaceAssets = screen.getByRole('button', { name: '资产' })
    expect(workspaceAssets.getAttribute('aria-current')).toBe('page')
    expect(workspaceAssets.getAttribute('aria-pressed')).toBeNull()
    expect(screen.getByRole('button', { name: '生成' }).getAttribute('aria-current')).toBeNull()
  })

  it('右侧依次是助手、设置与三个窗口控件；最大化后按钮改为“还原”', async () => {
    windowApi.isMaximized.mockResolvedValueOnce(true)
    await renderTitleBar({ onAssistantClick: vi.fn(), assistantOpen: true })

    expect(screen.getByRole('button', { name: '智能助手' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '设置' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '还原' }).dataset.windowControl).toBe('restore')

    fireEvent.click(screen.getByRole('button', { name: '最小化' }))
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(windowApi.minimize).toHaveBeenCalledTimes(1)
    expect(windowApi.close).toHaveBeenCalledTimes(1)
  })

  it('标题栏只用主题令牌：窗口底、发丝线与主要文字', async () => {
    const { container } = await renderTitleBar()
    const header = container.querySelector('header') as HTMLElement
    expect(header.className).toMatch(/(?:^|\s)bg-window(?:\s|$)/)
    expect(header.className).toMatch(/(?:^|\s)border-line(?:\s|$)/)
    expect(header.className).not.toMatch(/text-white|bg-panel/)
  })
})
