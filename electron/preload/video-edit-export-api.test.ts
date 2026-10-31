import { expect, it, vi } from 'vitest'
import { createVideoEditExportApi } from './video-edit-export-api'
import { VIDEO_EDIT_EXPORT_CHANNELS } from '../../src/platform/contracts/videoEditExport'
import { videoEditExportQualityEncoding } from '../../src/core/videoEdit/exportEncoding'

it('能力、压制、进度、取消共用页面身份，跨桥保留完整编码参数', async () => {
  const invoke = vi.fn(async (_channel: string, _payload?: unknown) => undefined)
  const api = createVideoEditExportApi(invoke as <T>(channel: string, payload?: unknown) => Promise<T>)
  const encoding = videoEditExportQualityEncoding('avc', 'visually_lossless', 'h264_nvenc')
  await api.capabilities(); await api.prepareCompression('job', '/out.mp4')
  await api.compress({ id: 'compress', encoding, fps: 60, durationSeconds: 10 })
  await api.compressionProgress('compress'); await api.cancelCompression('compress')
  expect(invoke.mock.calls.map(call => call[0])).toEqual([VIDEO_EDIT_EXPORT_CHANNELS.capabilities, VIDEO_EDIT_EXPORT_CHANNELS.prepareCompression, VIDEO_EDIT_EXPORT_CHANNELS.compress, VIDEO_EDIT_EXPORT_CHANNELS.compressionProgress, VIDEO_EDIT_EXPORT_CHANNELS.cancelCompression])
  const calls = invoke.mock.calls as unknown as Array<[string, { pageId?: string; encoding?: unknown }]>
  expect(new Set(calls.slice(1).map(call => call[1].pageId)).size).toBe(1)
  expect(calls[2][1].encoding).toEqual(encoding)
})
