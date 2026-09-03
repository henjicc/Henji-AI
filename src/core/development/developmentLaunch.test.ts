import { describe, expect, it } from 'vitest'

import { readDevelopmentLaunchOptions } from './developmentLaunch'

describe('readDevelopmentLaunchOptions', () => {
  it('默认不改变正常启动行为', () => {
    expect(readDevelopmentLaunchOptions('')).toEqual({
      skipOnboarding: false,
      surfaceId: null,
      mediaPath: null,
    })
  })

  it('读取开发启动页面和素材', () => {
    expect(readDevelopmentLaunchOptions(
      '?henjiDevSkipOnboarding=1&henjiDevSurface=tool.image_edit&henjiDevMedia=%2Ftmp%2Ftest.jpg'
    )).toEqual({
      skipOnboarding: true,
      surfaceId: 'tool.image_edit',
      mediaPath: '/tmp/test.jpg',
    })
  })
})
