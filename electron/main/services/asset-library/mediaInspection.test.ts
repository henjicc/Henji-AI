import { testCodeAssetSource } from '../../../../src/core/videoEdit/codeMaterial/sourceTestFixtures'
import { beforeEach, expect, it, vi } from 'vitest'
import { CODE_ASSET_LIMITS, CODE_ASSET_MIME, encodeCodeAsset } from '../../../../src/core/videoEdit/codeAsset'

const boundary = vi.hoisted(() => ({ stat: vi.fn(), read: vi.fn(), image: vi.fn(), video: vi.fn(), binary: vi.fn(), exec: vi.fn() }))
vi.mock('node:fs/promises', () => ({ default: { stat: boundary.stat } }))
vi.mock('node:child_process', () => ({ execFile: boundary.exec }))
vi.mock('../system', () => ({ readFileBytes: boundary.read }))
vi.mock('../image/ops', () => ({ readImageInfo: boundary.image }))
vi.mock('../video/ops', () => ({ readVideoInfo: boundary.video }))
vi.mock('../video/ffmpeg-loader', () => ({ loadFfprobePath: boundary.binary }))
import { inspectMedia } from './mediaInspection'

beforeEach(() => { vi.resetAllMocks(); boundary.stat.mockResolvedValue({ isFile: () => true, size: 200, mtimeMs: 100 }) })
it('代码原生检查有界读取并只验证清单；不编译源码、不解码图片或执行探测进程', async () => {
  const bytes = encodeCodeAsset({ format: 'henji-code-asset', version: 1, name: '待创作源码', ...testCodeAssetSource('throw new Error("must never execute")', 1), parameters: {}, images: [] })
  boundary.read.mockResolvedValue(bytes)
  expect(await inspectMedia('D:/source.henji-code', 'code')).toEqual({ mimeType: CODE_ASSET_MIME, sizeBytes: 200, fileModifiedAt: 100, width: null, height: null, durationSeconds: null })
  expect(boundary.read).toHaveBeenCalledWith('D:/source.henji-code', { maxBytes: CODE_ASSET_LIMITS.bytes })
  for (const operation of [boundary.image, boundary.video, boundary.binary, boundary.exec]) expect(operation).not.toHaveBeenCalled()
})
it('无效清单及超预算读取失败直接拒绝，不回退媒体探测', async () => {
  boundary.read.mockResolvedValueOnce(new TextEncoder().encode('{')).mockRejectedValueOnce(new Error('文件超预算'))
  await expect(inspectMedia('D:/invalid.henji-code', 'code')).rejects.toThrow()
  await expect(inspectMedia('D:/oversized.henji-code', 'code')).rejects.toThrow('超预算')
  expect(boundary.image).not.toHaveBeenCalled(); expect(boundary.exec).not.toHaveBeenCalled()
})
