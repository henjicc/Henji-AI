import { describe, expect, it, vi } from 'vitest'
import { decodeFileUrlPath, normalizeLocalSource } from './source'

// 替换未使用的文件持久化/CAS 边界，路径解码走正式实现，不加载 Electron 或访问用户资料。
vi.mock('./path-utils', () => ({ extensionFromMime: vi.fn(), mimeFromExtension: vi.fn(), normalizeExtension: vi.fn() }))
vi.mock('../image-editor-v3/resource-media-url', () => ({ IMAGE_EDITOR_V3_MEDIA_HOST: 'image-editor-v3', resolveImageEditorV3ResourceMediaUrl: vi.fn() }))

describe('图片源 file URL 解码', () => {
  it('localhost file URL 与无 host 形态还原到同一路径', () => {
    const localUrl = process.platform === 'win32' ? 'file:///C:/demo/a%20b.png' : 'file:///Users/demo/a%20b.png'
    const expected = process.platform === 'win32' ? 'C:/demo/a b.png' : '/Users/demo/a b.png'
    expect(decodeFileUrlPath(localUrl)).toBe(expected)
    expect(decodeFileUrlPath(localUrl.replace('file:///', 'file://localhost/'))).toBe(expected)
    expect(normalizeLocalSource(localUrl.replace('file:///', 'file://localhost/'))).toBe(expected)
  })
})
