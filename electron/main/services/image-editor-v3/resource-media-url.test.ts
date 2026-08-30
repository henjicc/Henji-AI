import { describe, expect, it, vi } from 'vitest'

vi.mock('../image/path-utils', () => ({
  getDataRootDir: () => '/managed-data',
}))

import {
  createImageEditorV3ResourceMediaUrl,
  resolveImageEditorV3ResourceMediaUrl,
} from './resource-media-url'

const RESOURCE = `sha256:${'ab'.repeat(32)}` as const

describe('图片编辑 V3 内容资源媒体 URL', () => {
  it('只公开内容哈希并在主进程恢复固定资源路径', () => {
    const mediaUrl = createImageEditorV3ResourceMediaUrl(RESOURCE, 'image/png')
    expect(mediaUrl).not.toContain('/managed-data')
    expect(resolveImageEditorV3ResourceMediaUrl(new URL(mediaUrl))).toEqual({
      targetPath: `/managed-data/ImageEditorV3/resources/objects/ab/${'ab'.repeat(32)}`,
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
