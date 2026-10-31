import path from 'node:path'
import { expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ BrowserWindow: class {}, session: {}, sharedTexture: {} }))
import { parseWebSourceCaptureRequest, parseWebSourceOpenRequest } from './pages'
import { codeWebPixelSize } from '../../../../src/core/videoEdit/codeMaterial/webSource'

it('运行时倍率支持低分辨率与输出放大，拒绝非数值倍率和歧义取消策略', () => {
  const request = { route: 'route', path: path.resolve('/site'), width: 100, height: 100, region: [0, 0, 100, 100], scale: 0.125 }
  expect(parseWebSourceOpenRequest(request).scale).toBe(0.125)
  expect(parseWebSourceOpenRequest({ ...request, scale: 32 }).scale).toBe(32)
  const capture = { streamId: 'web-1', ticket: 'web-2', time: 1, scale: 0.125, latest: true }
  expect(parseWebSourceCaptureRequest(capture)).toEqual(capture)
  expect(() => parseWebSourceCaptureRequest({ ...capture, scale: Infinity })).toThrow()
  expect(parseWebSourceCaptureRequest({ ...capture, scale: 8192 }).scale).toBe(8192)
  expect(() => parseWebSourceCaptureRequest({ ...capture, scale: 8193 })).toThrow()
  expect(() => parseWebSourceCaptureRequest({ ...capture, latest: 'true' })).toThrow()
})

it('输出取景像素夹在纹理有效范围，低分辨率的小取景仍保留一个像素', () => {
  const tiny = parseWebSourceOpenRequest({ route: 'r', path: path.resolve('/site'), width: 100, height: 100, region: [2, 3, 1, 1], scale: .0625 })
  expect(codeWebPixelSize(tiny)).toEqual({ width: 1, height: 1 })
  const large = parseWebSourceOpenRequest({ route: 'r', path: path.resolve('/site'), width: 8192, height: 8192, region: [0, 0, 8192, 8192], scale: 2 })
  expect(codeWebPixelSize(large)).toEqual({ width: 8192, height: 8192 })
})
