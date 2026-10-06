import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  saveImageFromUrl: vi.fn(),
}))

vi.mock('@/utils/save', () => ({
  isDesktop: () => true,
  saveImageFromUrl: mocks.saveImageFromUrl,
  saveVideoFromUrl: vi.fn(),
  saveAudioFromUrl: vi.fn(),
}))
vi.mock('@/platform/desktopApi', () => ({ toDisplaySrc: (path: string) => `henji-media://${path}` }))

import type { GenerationTask } from '../types'
import { normalizeMediaResultForDesktop } from './mediaResult'

const task = { id: 't', type: 'image' } as GenerationTask

describe('生成结果本地化（多结果数组）', () => {
  beforeEach(() => {
    mocks.saveImageFromUrl.mockReset()
    mocks.saveImageFromUrl.mockImplementation(async (url: string) => ({ fullPath: `/data/${url.split('/').pop()}` }))
  })

  it('已有本地文件时按顺序换成显示地址，不重复下载', async () => {
    await expect(normalizeMediaResultForDesktop(task, { urls: ['https://x/a.png', 'https://x/b.png'], filePaths: ['/m/a.png', '/m/b.png'] }, 'test'))
      .resolves.toEqual({ urls: ['henji-media:///m/a.png', 'henji-media:///m/b.png'], filePaths: ['/m/a.png', '/m/b.png'] })
    expect(mocks.saveImageFromUrl).not.toHaveBeenCalled()
  })

  it('只有远程地址时逐个保存，结果与输出顺序一一对应', async () => {
    await expect(normalizeMediaResultForDesktop(task, { urls: ['https://x/a.png', 'https://x/b.png'], filePaths: [] }, 'test'))
      .resolves.toEqual({ urls: ['henji-media:///data/a.png', 'henji-media:///data/b.png'], filePaths: ['/data/a.png', '/data/b.png'] })
    expect(mocks.saveImageFromUrl).toHaveBeenCalledTimes(2)
  })
})
