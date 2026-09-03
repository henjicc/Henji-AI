import { describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', () => ({
  existsSync: (value: string) => value.endsWith('/docs/ref/test01.jpg'),
  statSync: () => ({ isFile: () => true }),
}))

import { resolveDevelopmentLaunchQuery } from './development-launch'

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
    ], '/project')).toEqual({
      query: {
        henjiDevSkipOnboarding: '1',
        henjiDevSurface: 'tool.image_edit',
        henjiDevMedia: '/project/docs/ref/test01.jpg',
      },
      warnings: [],
    })
  })

  it('忽略无效页面和不存在的素材', () => {
    const result = resolveDevelopmentLaunchQuery([
      'electron',
      '--dev-surface=bad value',
      '--dev-media=missing.jpg',
    ], '/project')

    expect(result.query).toEqual({})
    expect(result.warnings).toHaveLength(2)
  })
})
