import { describe, expect, it, vi } from 'vitest'
import path from 'node:path'

vi.mock('node:fs', () => ({
  existsSync: (value: string) => value.replaceAll('\\', '/').endsWith('/docs/ref/test01.jpg'),
  statSync: () => ({ isFile: () => true }),
}))

import { resolveDevelopmentLaunchQuery, resolveSecondaryWindowLaunchQuery } from './development-launch'

describe('resolveDevelopmentLaunchQuery', () => {
  it('没有显式参数时保持正常启动', () => {
    expect(resolveDevelopmentLaunchQuery(['electron'], '/project')).toEqual({
      query: {},
      warnings: [],
    })
  })

  it('生成一次性的开发启动查询参数', () => {
    expect(resolveDevelopmentLaunchQuery([
      'electron',
      '--dev-skip-onboarding',
      '--dev-surface=tool.image_edit',
      '--dev-media=docs/ref/test01.jpg',
      '--dev-theme-preset=paper',
      '--dev-update-preview=failed',
    ], '/project')).toEqual({
      query: {
        henjiDevSkipOnboarding: '1',
        henjiDevSurface: 'tool.image_edit',
        henjiDevThemePreset: 'paper',
        henjiDevUpdatePreview: 'failed',
        henjiDevMedia: path.resolve('/project', 'docs/ref/test01.jpg'),
      },
      warnings: [],
    })
  })

  it('忽略无效页面和不存在的素材', () => {
    const result = resolveDevelopmentLaunchQuery([
      'electron',
      '--dev-surface=bad value',
      '--dev-media=missing.jpg',
      '--dev-theme-preset=sepia',
      '--dev-update-preview=install',
    ], '/project')

    expect(result.query).toEqual({})
    expect(result.warnings).toHaveLength(4)
  })
})

describe('resolveSecondaryWindowLaunchQuery', () => {
  it('日志窗口只沿用主题预设，不带页面定位、素材与首次引导', () => {
    expect(resolveSecondaryWindowLaunchQuery([
      'electron',
      '--dev-skip-onboarding',
      '--dev-surface=tool.image_edit',
      '--dev-media=docs/ref/test01.jpg',
      '--dev-theme-preset=paper',
      '--dev-update-preview=available',
    ], '/project')).toEqual({ henjiDevThemePreset: 'paper' })
  })

  it('没有或无效的主题预设时不附加参数', () => {
    expect(resolveSecondaryWindowLaunchQuery(['electron'], '/project')).toEqual({})
    expect(resolveSecondaryWindowLaunchQuery(['electron', '--dev-theme-preset=sepia'], '/project')).toEqual({})
  })
})
