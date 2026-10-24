import { describe, expect, it } from 'vitest'

import { readDevelopmentLaunchOptions } from './developmentLaunch'

describe('readDevelopmentLaunchOptions', () => {
  it('默认不改变正常启动行为', () => {
    expect(readDevelopmentLaunchOptions('')).toEqual({
      skipOnboarding: false,
      surfaceId: null,
      mediaPath: null,
      themePresetId: null,
      updatePreview: null,
      layoutGuard: null,
    })
  })

  it('读取布局守卫模式，无效值忽略（重要记录 020）', () => {
    expect(readDevelopmentLaunchOptions('?henjiDevLayoutGuard=log').layoutGuard).toBe('log')
    expect(readDevelopmentLaunchOptions('?henjiDevLayoutGuard=outline').layoutGuard).toBe('outline')
    expect(readDevelopmentLaunchOptions('?henjiDevLayoutGuard=on').layoutGuard).toBeNull()
  })

  it('读取更新提示弹窗预览状态，无效值忽略', () => {
    expect(readDevelopmentLaunchOptions('?henjiDevUpdatePreview=downloading').updatePreview).toBe('downloading')
    expect(readDevelopmentLaunchOptions('?henjiDevUpdatePreview=install').updatePreview).toBeNull()
  })

  it('读取开发启动页面和素材', () => {
    expect(readDevelopmentLaunchOptions(
      '?henjiDevSkipOnboarding=1&henjiDevSurface=tool.image_edit&henjiDevMedia=%2Ftmp%2Ftest.jpg&henjiDevThemePreset=paper'
    )).toEqual({
      skipOnboarding: true,
      surfaceId: 'tool.image_edit',
      mediaPath: '/tmp/test.jpg',
      themePresetId: 'paper',
      updatePreview: null,
      layoutGuard: null,
    })
  })
})
