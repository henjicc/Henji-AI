import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('设计系统中心页契约', () => {
  const page = readFileSync(new URL('./UiGalleryPage.tsx', import.meta.url), 'utf8')
  const samples = readFileSync(new URL('./gallerySections.tsx', import.meta.url), 'utf8')
  it('开发守卫、搜索目录与临时主题预览均存在', () => {
    expect(page).toContain('import.meta.env.DEV')
    expect(page).toContain('UiSearchInput')
    expect(page).toContain('UiNavButton')
    expect(page).toContain('previewGalleryTheme')
  })
  it('不再把独立选项按钮拼成分段正例', () => {
    expect(samples).not.toContain('UI_SEGMENTED_TRACK_CLASS')
  })
  it('静态弹窗、提示、右键菜单及尺寸阶梯进入样本', () => {
    expect(samples).toContain('SizeLadderSection')
    expect(samples).toContain('scope="container"')
    expect(samples).toContain('<TooltipContent')
    expect(samples).toContain('<ContextMenu')
  })
})
