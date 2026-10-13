/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { previewGalleryTheme, searchGallery, readLiteralUnion, GALLERY_CONTROL_SIZES, GALLERY_ICON_SIZES } from './galleryIndex'
import { THEME_PRESETS } from '@/core/theme/themeEngine'
import { getThemeTokens } from '@/core/theme/themeTokenStore'
import { UI_CONTROL_HEIGHT_CLASS } from '@/components/ui/styleTokens'

afterEach(() => { vi.restoreAllMocks() })

describe('中心页临时预览与搜索', () => {
  it('主题切换即时发布真值，卸载恢复原变量/半径/玻璃，不写持久缓存或用户设置', () => {
    const root = document.createElement('div')
    root.style.setProperty('--window', 'var(--panel)', 'important')
    root.style.setProperty('--ui-glass-tint', 'var(--raised)')
    root.dataset.uiRadius = 'compact'
    root.dataset.uiBlur = 'off'
    const before = root.getAttribute('style')
    const tokens = getThemeTokens()
    const storage = vi.spyOn(Storage.prototype, 'setItem')
    const restore = previewGalleryTheme(root, THEME_PRESETS.paper.seed, 'large', true)
    expect(getThemeTokens().mode).toBe('light')
    expect(root.dataset.uiRadius).toBe('large')
    expect(root.hasAttribute('data-ui-blur')).toBe(false)
    expect(root.style.getPropertyValue('--ui-glass-tint')).toBe('')
    expect(storage).not.toHaveBeenCalled()
    restore()
    expect(root.getAttribute('style')).toBe(before)
    expect(root.dataset.uiRadius).toBe('compact')
    expect(root.dataset.uiBlur).toBe('off')
    expect(getThemeTokens()).toEqual(tokens)
  })

  it('支持组件名、令牌名和规范关键词，并区分明确登记的欠账', () => {
    expect(searchGallery('UiModal').map(entry => entry.id)).toContain('modal-sizes')
    expect(searchGallery('UI_DURATION').map(entry => entry.id)).toContain('motion')
    expect(searchGallery('UI_TEXT_TITLE_CLASS').map(entry => entry.id)).toContain('type')
    expect(searchGallery('ICON_SETTINGS').map(entry => entry.id)).toContain('icons')
    expect(searchGallery('--control-hover').map(entry => entry.id)).toContain('colors')
    expect(searchGallery('中性抬起底').map(entry => entry.id)).toContain('options')
    expect(searchGallery('不存在的组件')).toEqual([])
    expect(searchGallery('', true).every(entry => !!entry.issue)).toBe(true)
    expect(searchGallery('', true).length).toBeGreaterThan(0)
  })

  it('控件尺寸来自真实令牌对象，图标尺寸来自真实源码联合类型', () => {
    expect(GALLERY_CONTROL_SIZES).toEqual(Object.keys(UI_CONTROL_HEIGHT_CLASS))
    expect(GALLERY_ICON_SIZES.length).toBeGreaterThan(GALLERY_CONTROL_SIZES.length)
    expect(new Set(GALLERY_ICON_SIZES).size).toBe(GALLERY_ICON_SIZES.length)
  })

  it('4.2 改为共用尺寸别名时，阶梯自动展开别名与多行联合类型', () => {
    const source = "export type Shared = 'sm' | 'md' | 'lg';\nexport type Changed =\n  | '2xs'\n  | 'xs'\n  | Shared\n  | 'xl';"
    expect(readLiteralUnion(source, 'Changed')).toEqual(['2xs', 'xs', 'sm', 'md', 'lg', 'xl'])
  })
})
