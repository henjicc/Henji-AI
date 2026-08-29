import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ root: '' }))

vi.mock('electron', () => ({ app: { getPath: () => mocks.root } }))
vi.mock('../dataRoot', () => ({ getCustomDataRoot: () => mocks.root }))

import {
  releaseManagedGenerationMediaPaths,
  releaseManagedImagePaths,
} from './path-utils'

describe('受管生成媒体释放边界', () => {
  beforeEach(() => {
    mocks.root = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-managed-media-'))
  })

  afterEach(() => {
    fs.rmSync(mocks.root, { recursive: true, force: true })
  })

  it('通用生成回滚只删除 Uploads 与 Media 内的目标', () => {
    const upload = path.join(mocks.root, 'Uploads', 'image.png')
    const media = path.join(mocks.root, 'Media', 'video.mp4')
    fs.mkdirSync(path.dirname(upload), { recursive: true })
    fs.mkdirSync(path.dirname(media), { recursive: true })
    fs.writeFileSync(upload, 'image')
    fs.writeFileSync(media, 'video')

    releaseManagedGenerationMediaPaths([upload, media])

    expect(fs.existsSync(upload)).toBe(false)
    expect(fs.existsSync(media)).toBe(false)
  })

  it('图层专用释放仍拒绝 Media，通用入口拒绝数据根外路径', () => {
    const media = path.join(mocks.root, 'Media', 'video.mp4')
    const outside = path.join(path.dirname(mocks.root), 'outside.mp4')
    fs.mkdirSync(path.dirname(media), { recursive: true })
    fs.writeFileSync(media, 'video')
    fs.writeFileSync(outside, 'outside')

    expect(() => releaseManagedImagePaths([media])).toThrow('Uploads')
    expect(() => releaseManagedGenerationMediaPaths([outside])).toThrow('受管生成媒体')
    expect(fs.existsSync(media)).toBe(true)
    expect(fs.existsSync(outside)).toBe(true)
    fs.rmSync(outside, { force: true })
  })
})
