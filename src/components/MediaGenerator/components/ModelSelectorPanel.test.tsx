// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import i18n from '@/i18n/config'
import ModelSelectorPanel from './ModelSelectorPanel'

vi.mock('@/utils/modelHelpers', () => ({ getAvailableProviders: () => [{
  id: 'test-provider', name: '测试供应商', models: [{ id: 'test-image', name: '测试图片模型', type: 'image', functions: [] }],
}] }))
vi.mock('@/config/providers', () => ({
  getHiddenProviders: () => new Set(), getHiddenTypes: () => new Set(), getHiddenModels: () => new Set(),
  getVisibleProviders: (_providers: Set<string>, _types: Set<string>, _models: Set<string>, providers: unknown[]) => providers,
}))
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks()
  if (originalScroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll)
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
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
