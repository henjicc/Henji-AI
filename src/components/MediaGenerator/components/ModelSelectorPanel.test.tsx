// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import i18n from '@/i18n/config'
import ModelSelectorPanel from './ModelSelectorPanel'

const data = vi.hoisted(() => ({ count: 1 }))
vi.mock('@/utils/modelHelpers', () => ({ getAvailableProviders: () => [{
  id: 'test-provider', name: '测试供应商', models: Array.from({ length: data.count }, (_, index) => ({ id: index === 0 ? 'test-image' : `model-${index}`, name: `测试图片模型${index}`, type: 'image', functions: [] })),
}] }))
vi.mock('@/config/providers', () => ({
  getHiddenProviders: () => new Set(), getHiddenTypes: () => new Set(), getHiddenModels: () => new Set(),
  getVisibleProviders: (_providers: Set<string>, _types: Set<string>, _models: Set<string>, providers: unknown[]) => providers,
}))
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
beforeEach(() => {
  data.count = 1
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})
afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks()
  if (originalScroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll)
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
})

it('123 个模型只挂载首屏网格，方向键可选择未挂载的第 61 项', () => {
  data.count = 123
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  const select = vi.fn()
  const view = render(<ModelSelectorPanel selectedProvider="" selectedModel=""
    modelFilterProvider="all" modelFilterType="all" modelFilterFunction="all" favoriteModels={new Set()}
    onModelSelect={select} onFilterProviderChange={() => undefined} onFilterTypeChange={() => undefined}
    onFilterFunctionChange={() => undefined} onToggleFavorite={() => undefined} />)
  expect(view.container.querySelectorAll('[data-model-id]').length).toBeLessThan(50)
  const panel = view.container.querySelector('[data-model-selector-panel]')!
  for (let index = 0; index < 60; index++) fireEvent.keyDown(panel, { key: 'ArrowRight' })
  fireEvent.keyDown(panel, { key: 'Enter' })
  expect(select).toHaveBeenCalledWith('test-provider', 'model-60')
})

it('首次挂到其他窗口时立即按所属窗口宽度选择列数', () => {
  const iframe = document.createElement('iframe')
  document.body.append(iframe)
  const owner = iframe.contentWindow!
  Object.defineProperty(owner, 'innerWidth', { configurable: true, value: 600 })
  const view = render(<ModelSelectorPanel selectedProvider="" selectedModel=""
    modelFilterProvider="all" modelFilterType="all" modelFilterFunction="all" favoriteModels={new Set()}
    onModelSelect={() => undefined} onFilterProviderChange={() => undefined} onFilterTypeChange={() => undefined}
    onFilterFunctionChange={() => undefined} onToggleFavorite={() => undefined} />, { container: owner.document.body })
  try {
    // 600 宽的浮窗：特殊面板上限收到 568，左栏之外只放得下两列 190 宽的格子
    const body = view.container.querySelector('[data-special-panel-body]') as HTMLElement
    expect(body.style.width).toBe('410px')
  } finally {
    view.unmount()
    iframe.remove()
  }
})

it('筛选都在头部一行与左栏：点类型与供应商不会误选模型，收藏走左栏', async () => {
  await i18n.changeLanguage('zh-CN')
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  const selectModel = vi.fn(), selectType = vi.fn(), selectProvider = vi.fn()
  const view = render(<ModelSelectorPanel selectedProvider="test-provider" selectedModel="test-image"
    modelFilterProvider="all" modelFilterType="all" modelFilterFunction="all" favoriteModels={new Set()}
    onModelSelect={selectModel} onFilterProviderChange={selectProvider} onFilterTypeChange={selectType}
    onFilterFunctionChange={() => undefined} onToggleFavorite={() => undefined} />)
  expect(view.container.querySelectorAll('[data-ui-form-row]')).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: '图片' }))
  expect(selectType).toHaveBeenCalledWith('image')
  fireEvent.click(view.container.querySelector('[data-model-filter-provider="test-provider"]')!)
  expect(selectProvider).toHaveBeenCalledWith('test-provider')
  fireEvent.click(view.container.querySelector('[data-model-filter-provider="favorite"]')!)
  expect(selectType).toHaveBeenLastCalledWith('favorite')
  expect(selectModel).not.toHaveBeenCalled()
})
