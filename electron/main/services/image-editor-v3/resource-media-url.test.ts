import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

vi.mock('../appPaths', () => ({
  getProgramStoreDir: () => '/managed-data/ImageEditorV3',
}))

import {
  createImageEditorV3ResourceMediaUrl,
  readImageEditorV3SourceMediaUrl,
  resolveImageEditorV3ResourceMediaUrl,
} from './resource-media-url'

const RESOURCE = `sha256:${'ab'.repeat(32)}` as const

describe('图片编辑 V3 内容资源媒体 URL', () => {
  it('重开源图时依据文件头恢复 MIME，不依赖资源描述中的临时 MIME', async () => {
    const sources = { readMetadata: vi.fn(async () => ({
      resourceId: RESOURCE, width: 32, height: 24, encodedWidth: 32, encodedHeight: 24,
      format: 'PNG', bitsPerSample: 8, orientation: 1 as const, orientationApplied: true as const,
      hasAlpha: false, hasIccProfile: false, cicp: null, hdr: false,
    })) }
    const url = await readImageEditorV3SourceMediaUrl(RESOURCE, sources)
    expect(sources.readMetadata).toHaveBeenCalledWith(RESOURCE)
    expect(resolveImageEditorV3ResourceMediaUrl(new URL(url!)).mediaType).toBe('image/png')
    sources.readMetadata.mockResolvedValueOnce({ ...(await sources.readMetadata()), format: 'unknown' })
    await expect(readImageEditorV3SourceMediaUrl(RESOURCE, sources)).resolves.toBeNull()
  })

  it('只公开内容哈希并在主进程恢复固定资源路径', () => {
    const mediaUrl = createImageEditorV3ResourceMediaUrl(RESOURCE, 'image/png')
    expect(mediaUrl).not.toContain('/managed-data')
    expect(resolveImageEditorV3ResourceMediaUrl(new URL(mediaUrl))).toEqual({
      targetPath: path.join('/managed-data', 'ImageEditorV3', 'resources', 'objects', 'ab', 'ab'.repeat(32)),
      mediaType: 'image/png',
    })
  })

  it('拒绝路径、未知媒体类型和额外查询字段', () => {
    expect(() => resolveImageEditorV3ResourceMediaUrl(
      new URL(`henji-media://image-editor-v3/${'ab'.repeat(31)}%2Faa?mediaType=image/png`),
    )).toThrow()
    expect(() => createImageEditorV3ResourceMediaUrl(RESOURCE, 'text/html')).toThrow()
    expect(() => resolveImageEditorV3ResourceMediaUrl(
      new URL(`henji-media://image-editor-v3/${'ab'.repeat(32)}?mediaType=image/png&path=x`),
    )).toThrow()
  })
})
