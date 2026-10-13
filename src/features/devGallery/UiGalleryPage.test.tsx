/** @vitest-environment jsdom */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { UiGalleryPage } from './UiGalleryPage'

// 页面测试保留正式导航/搜索控件，只隔离需要媒体、字体及 Canvas 的叶子样本。
vi.mock('./gallerySections', () => Object.fromEntries([
  'ButtonSection', 'ContentSection', 'DialogSection', 'FieldSection', 'FilterSection', 'FormSection',
  'MediaSection', 'MenuSection', 'NavigationSection', 'OptionSection', 'StateSection', 'ToggleSection',
  'ToolbarSection', 'SizeLadderSection', 'VariantSection', 'ModalSizeSection', 'StaticOverlaySection',
  'ParameterSizeSection', 'SharedDomainSection',
].map(name => [name, () => <div>{name}</div>])))
vi.mock('./tokenSections', () => Object.fromEntries([
  'ColorTokensSection', 'TypeTokensSection', 'SpacingTokensSection', 'RadiusTokensSection',
  'ShadowTokensSection', 'LayerTokensSection', 'HeightTokensSection', 'IconTokensSection',
  'MotionTokensSection', 'SourceTokensSection',
].map(name => [name, () => <div>{name}</div>])))
vi.mock('./patternSections', () => Object.fromEntries(['PatternSection', 'RulesSection', 'LongListSection'].map(name => [name, () => <div>{name}</div>])))

afterEach(() => { cleanup(); vi.unstubAllEnvs(); window.history.replaceState(null, '', '/') })

it('点击目录选择完整分区并同步页内 query，搜索组件名自动跳转，清除恢复原选择', () => {
  const view = render(<UiGalleryPage />)
  expect(view.container.querySelector('[data-gallery-section="dialogs"]')).not.toBeNull()
  fireEvent.click(view.getByRole('button', { name: /^颜色$/ }))
  expect(view.container.querySelector('[data-gallery-section="colors"]')).not.toBeNull()
  expect(new URLSearchParams(window.location.search).get('henjiGallerySection')).toBe('colors')
  fireEvent.change(view.getByRole('textbox', { name: '搜索设计系统' }), { target: { value: 'UiModal' } })
  expect(view.container.querySelector('[data-gallery-section="modal-sizes"]')).not.toBeNull()
  fireEvent.click(view.getByRole('button', { name: '清除搜索' }))
  expect(view.container.querySelector('[data-gallery-section="colors"]')).not.toBeNull()
})

it('直接打开已登记分区并能显示搜索无结果和登记问题筛选', () => {
  window.history.replaceState(null, '', '/?henjiDevSurface=dev.ui_gallery&henjiGallerySection=icons')
  const view = render(<UiGalleryPage />)
  expect(view.container.querySelector('[data-gallery-section="icons"]')).not.toBeNull()
  fireEvent.click(view.getByRole('switch', { name: '只看登记问题' }))
  expect(view.queryByRole('button', { name: /^排版$/ })).toBeNull()
  fireEvent.change(view.getByRole('textbox', { name: '搜索设计系统' }), { target: { value: '完全不存在' } })
  expect(view.getByText('没有匹配的样本')).not.toBeNull()
})

it('生产构建拒绝挂载设计系统内容', () => {
  vi.stubEnv('DEV', false)
  const view = render(<UiGalleryPage />)
  expect(view.container.childElementCount).toBe(0)
})

it('进入时圆角与玻璃控件读当前主题属性，不把关闭状态显示为开启', () => {
  document.documentElement.dataset.uiRadius = 'compact'
  document.documentElement.dataset.uiBlur = 'off'
  try {
    const view = render(<UiGalleryPage />)
    expect(view.getByRole('radio', { name: '紧凑' }).getAttribute('aria-checked')).toBe('true')
    expect(view.getByRole('switch', { name: '毛玻璃预览' }).getAttribute('aria-checked')).toBe('false')
  } finally {
    delete document.documentElement.dataset.uiRadius
    delete document.documentElement.dataset.uiBlur
  }
})
