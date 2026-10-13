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
  Object.defineProperty(owner, 'innerWidth', { configurable: true, value: 700 })
  const view = render(<ModelSelectorPanel selectedProvider="" selectedModel=""
    modelFilterProvider="all" modelFilterType="all" modelFilterFunction="all" favoriteModels={new Set()}
    onModelSelect={() => undefined} onFilterProviderChange={() => undefined} onFilterTypeChange={() => undefined}
    onFilterFunctionChange={() => undefined} onToggleFavorite={() => undefined} />, { container: owner.document.body })
  try {
    expect(view.container.querySelector('.grid-cols-3')).not.toBeNull()
    expect(view.container.querySelector('.grid-cols-4')).toBeNull()
  } finally {
    view.unmount()
    iframe.remove()
  }
})

it('三组筛选共用表单行，键盘选择筛选不会误选模型', async () => {
  await i18n.changeLanguage('zh-CN')
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  const selectModel = vi.fn(), selectType = vi.fn()
  const view = render(<ModelSelectorPanel selectedProvider="test-provider" selectedModel="test-image"
    modelFilterProvider="all" modelFilterType="all" modelFilterFunction="all" favoriteModels={new Set()}
    onModelSelect={selectModel} onFilterProviderChange={() => undefined} onFilterTypeChange={selectType}
    onFilterFunctionChange={() => undefined} onToggleFavorite={() => undefined} />)
  expect(view.container.querySelectorAll('[data-ui-form-row="panel"]')).toHaveLength(3)
  const filter = screen.getByRole('button', { name: '类型' })
  fireEvent.keyDown(filter, { key: 'Enter' })
  fireEvent.keyDown(filter, { key: 'ArrowDown' })
  fireEvent.keyDown(filter, { key: 'ArrowDown' })
  fireEvent.keyDown(filter, { key: 'Enter' })
  expect(selectType).toHaveBeenCalledWith('image')
  expect(selectModel).not.toHaveBeenCalled()
})
