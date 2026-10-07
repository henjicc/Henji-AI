import { beforeEach, expect, it, vi } from 'vitest'
import { canEncodeVideo } from 'mediabunny'
import { selectVideoEditExportEncoder } from './videoEditExportEncoder'
vi.mock('mediabunny', () => ({ canEncodeVideo: vi.fn() }))
const spec = { width: 7680, height: 4320, frameRate: 120, bitrate: 80_000_000 }
beforeEach(() => { vi.mocked(canEncodeVideo).mockReset() })
it('8K/120与竖屏优先探测HEVC并使用实际尺寸、帧率、码率', async () => {
  vi.mocked(canEncodeVideo).mockResolvedValue(true)
  expect(await selectVideoEditExportEncoder(spec)).toBe('hevc')
  expect(canEncodeVideo).toHaveBeenCalledWith('hevc', spec)
  expect(await selectVideoEditExportEncoder({ ...spec, width: 4320, height: 7680 })).toBe('hevc')
})
it('普通规格保留H.264优先，设备不支持时尝试HEVC', async () => {
  vi.mocked(canEncodeVideo).mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  expect(await selectVideoEditExportEncoder({ ...spec, width: 1920, height: 1080 })).toBe('hevc')
  expect(vi.mocked(canEncodeVideo).mock.calls.map(call => call[0])).toEqual(['avc', 'hevc'])
})
it('两种编码都不支持时说明不可用规格与恢复方式', async () => {
  vi.mocked(canEncodeVideo).mockResolvedValue(false)
  await expect(selectVideoEditExportEncoder(spec)).rejects.toThrow('当前设备无法导出 7680 × 4320 · 120 帧视频。请降低导出分辨率或帧率后重试。')
})
