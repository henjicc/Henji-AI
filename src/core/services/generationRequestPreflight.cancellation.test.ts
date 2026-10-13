import { beforeEach, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ compress: vi.fn(), trim: vi.fn() }))
vi.mock('@/commands/video', () => ({ compressVideoToFit: mock.compress, trimVideoSource: mock.trim }))
vi.mock('@/commands/image', () => ({ cropImageSource: vi.fn(), readImageInfo: vi.fn() }))
vi.mock('@/core/inputs/inputLimits', () => ({ resolveInputLimits: () => ({ videoConstraints: { maxSizeMB: 10 } }) }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn() }) }))
import { compressFirstVideoIfNeeded, trimFirstVideoIfSelected } from './generationRequestPreflight'
import type { ModelDefinition } from '@/core/types'
const model = { meta: { id: 'test' } } as ModelDefinition
const params = { uploadedVideoFilePaths: ['C:/large.mp4'], uploadedVideoTrimStart: 0, uploadedVideoTrimEnd: 5 }
beforeEach(() => { vi.resetAllMocks() })
it.each(['compress', 'trim'] as const)('%s 预检取消不能吞掉错误，已取消时不启动操作', async kind => {
  const controller = new AbortController()
  const operation = kind === 'compress' ? mock.compress : mock.trim
  operation.mockImplementation(async () => { controller.abort(); throw new Error('process aborted') })
  const run = () => kind === 'compress' ? compressFirstVideoIfNeeded(model, params, controller.signal) : trimFirstVideoIfSelected(params, controller.signal)
  await expect(run()).rejects.toMatchObject({ name: 'AbortError' })
  operation.mockClear()
  await expect(run()).rejects.toMatchObject({ name: 'AbortError' })
  expect(operation).not.toHaveBeenCalled()
})
it.each(['compress', 'trim'] as const)('%s 收到 AbortError 即使信号未设置也向上传播，普通失败仍回退', async kind => {
  const operation = kind === 'compress' ? mock.compress : mock.trim
  const run = () => kind === 'compress' ? compressFirstVideoIfNeeded(model, params) : trimFirstVideoIfSelected(params)
  operation.mockRejectedValue(new DOMException('取消', 'AbortError'))
  await expect(run()).rejects.toMatchObject({ name: 'AbortError' })
  operation.mockRejectedValue(new Error('encoder failed'))
  expect(await run()).toBe(params)
})
