import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./path-utils', async (importOriginal) => {
  const original = await importOriginal<typeof import('./path-utils')>()
  return {
    ...original,
    persistImageBytes: vi.fn((bytes: Buffer) => `data:image/png;base64,${bytes.toString('base64')}`),
    persistImageBytesTracked: vi.fn((bytes: Buffer) => ({
      filePath: `data:image/png;base64,${bytes.toString('base64')}`,
      created: true,
    })),
  }
})

vi.mock('./registration/worker-client', async () => {
  const { registerLocalRedrawFrames } = await import('./registration/register')
  return {
    registerLocalRedrawFramesInWorker: vi.fn(async (
      referenceFrame: Parameters<typeof registerLocalRedrawFrames>[0],
      movingFrame: Parameters<typeof registerLocalRedrawFrames>[1],
      quality: Parameters<typeof registerLocalRedrawFrames>[2],
      forceApplyResult: Parameters<typeof registerLocalRedrawFrames>[3],
    ) => ({
      result: registerLocalRedrawFrames(referenceFrame, movingFrame, quality, forceApplyResult),
      movingData: movingFrame.data,
    })),
  }
})

import { composeLocalRedraw, prepareLocalRedraw } from './local-redraw'
import { describeLocalRedrawError, describeLocalRedrawSource } from './local-redraw-logging'
import { registerLocalRedrawFramesInWorker } from './registration/worker-client'
import { loadSharp } from './sharp-loader'
import { persistImageBytes, persistImageBytesTracked } from './path-utils'

function dataUrl(bytes: Buffer): string {
  return `data:image/png;base64,${bytes.toString('base64')}`
}

describe('局部重绘裁剪与回贴', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('日志源描述不会暴露本地路径、远程地址或未知输入', () => {
    const sensitiveSources = [
      '/Users/private-user/secret-project/source.png',
      'file:///Users/private-user/secret-project/mask.png',
      'https://example.com/private/image.png?token=secret',
      'provider-resource-with-secret-token',
    ]
    const descriptors = sensitiveSources.map(describeLocalRedrawSource)

    expect(descriptors).toEqual([
      { kind: 'local-path' },
      { kind: 'local-path' },
      { kind: 'remote-url' },
      { kind: 'other' },
    ])
    const serialized = JSON.stringify(descriptors)
    for (const source of sensitiveSources) expect(serialized).not.toContain(source)
  })

  it('Data URL 日志只保留媒体类型和长度', () => {
    const source = 'data:image/png;base64,c2VjcmV0LWJ5dGVz'
    expect(describeLocalRedrawSource(source)).toEqual({
      kind: 'data-url',
      mime: 'image/png',
      length: source.length,
    })
  })

  it('错误日志不会透传包含路径的消息和堆栈', () => {
    const error = Object.assign(
      new Error("ENOENT: no such file or directory, open '/Users/private-user/secret.png'"),
      { code: 'ENOENT' },
    )
    const descriptor = describeLocalRedrawError(error)

    expect(descriptor).toEqual({ name: 'Error', code: 'ENOENT' })
    expect(JSON.stringify(descriptor)).not.toContain('/Users/private-user/secret.png')
  })

  it('按蒙版范围放大并匹配裁剪比例', async () => {
    const sharp = await loadSharp()
    const source = await sharp({ create: { width: 100, height: 80, channels: 3, background: { r: 20, g: 30, b: 40 } } }).png().toBuffer()
    const maskPixels = Buffer.alloc(100 * 80 * 4, 255)
    for (let y = 30; y < 40; y += 1) for (let x = 45; x < 55; x += 1) maskPixels[(y * 100 + x) * 4 + 3] = 0
    const mask = await sharp(maskPixels, { raw: { width: 100, height: 80, channels: 4 } }).png().toBuffer()
    const result = await prepareLocalRedraw({
      source: dataUrl(source),
      mask: dataUrl(mask),
      settings: { contextScale: 3, aspectRatio: '1:1', registrationQuality: 'fast', featherPixels: 0, forceRegistration: false },
    })
    expect(result.context.crop.width).toBe(result.context.crop.height)
    expect(result.context.crop.width).toBeGreaterThanOrEqual(64)
    expect(result.context.version).toBe(2)
    expect(result.context.matchedAspectRatio).toBe(1)
    expect(result.cropSource).toMatch(/^data:image\/png;base64,/)
    expect(result.createdFilePaths).toEqual([result.cropSource])
  })

  it('裁剪命中既有内容寻址文件时不声明清理所有权', async () => {
    const sharp = await loadSharp()
    const source = await sharp({ create: { width: 80, height: 80, channels: 3, background: { r: 20, g: 30, b: 40 } } }).png().toBuffer()
    const maskPixels = Buffer.alloc(80 * 80 * 4, 255)
    for (let y = 30; y < 50; y += 1) for (let x = 30; x < 50; x += 1) maskPixels[(y * 80 + x) * 4 + 3] = 0
    const mask = await sharp(maskPixels, { raw: { width: 80, height: 80, channels: 4 } }).png().toBuffer()
    vi.mocked(persistImageBytesTracked).mockReturnValueOnce({
      filePath: '/managed/existing-crop.png',
      created: false,
    })

    const result = await prepareLocalRedraw({
      source: dataUrl(source),
      mask: dataUrl(mask),
      settings: { contextScale: 2, aspectRatio: '1:1', registrationQuality: 'fast', featherPixels: 0, forceRegistration: false },
    })

    expect(result.cropSource).toBe('/managed/existing-crop.png')
    expect(result.createdFilePaths).toEqual([])
  })

  it('智能裁剪优先匹配当前模型真实支持的最近比例', async () => {
    const sharp = await loadSharp()
    const source = await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 20, g: 30, b: 40 } } }).png().toBuffer()
    const maskPixels = Buffer.alloc(200 * 200 * 4, 255)
    for (let y = 60; y < 140; y += 1) for (let x = 85; x < 115; x += 1) maskPixels[(y * 200 + x) * 4 + 3] = 0
    const mask = await sharp(maskPixels, { raw: { width: 200, height: 200, channels: 4 } }).png().toBuffer()

    const result = await prepareLocalRedraw({
      source: dataUrl(source),
      mask: dataUrl(mask),
      preferredAspectRatios: [1, 0.8],
      settings: { contextScale: 2, aspectRatio: 'auto', registrationQuality: 'precise', featherPixels: 12, forceRegistration: false },
    })

    expect(result.context.matchedAspectRatio).toBe(0.8)
    expect(result.context.crop.width / result.context.crop.height).toBeCloseTo(0.8, 2)
  })

  it('对齐置信度不足时按原位回贴，只改变蒙版区域', async () => {
    const sharp = await loadSharp()
    const source = await sharp({ create: { width: 32, height: 32, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } } }).png().toBuffer()
    const maskPixels = Buffer.alloc(32 * 32 * 4, 255)
    for (let y = 8; y < 24; y += 1) for (let x = 8; x < 24; x += 1) maskPixels[(y * 32 + x) * 4 + 3] = 0
    const mask = await sharp(maskPixels, { raw: { width: 32, height: 32, channels: 4 } }).png().toBuffer()
    const generated = await sharp({ create: { width: 32, height: 32, channels: 4, background: { r: 240, g: 30, b: 20, alpha: 1 } } }).png().toBuffer()
    const result = await composeLocalRedraw({
      generatedSource: dataUrl(generated),
      context: {
        version: 2,
        requestId: 'compose-fallback',
        source: dataUrl(source),
        mask: dataUrl(mask),
        sourceWidth: 32,
        sourceHeight: 32,
        crop: { x: 0, y: 0, width: 32, height: 32 },
        matchedAspectRatio: 1,
        settings: { contextScale: 2, aspectRatio: 'auto', registrationQuality: 'fast', featherPixels: 0, forceRegistration: false },
      },
    })
    const encoded = vi.mocked(persistImageBytes).mock.calls.at(-1)?.[0]
    if (!encoded) throw new Error('测试输出未写入')
    const { data } = await sharp(encoded).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    expect([...data.subarray(0, 3)]).toEqual([10, 20, 30])
    const center = (16 * 32 + 16) * 4
    expect([...data.subarray(center, center + 3)]).toEqual([240, 30, 20])
    expect(result.registrationApplied).toBe(false)
    expect(result.diagnostics.selectedChangeFraction).toBe(1)
    expect(registerLocalRedrawFramesInWorker).toHaveBeenCalledTimes(1)
  })

  it('羽化后仍按单通道遮罩回贴，不会把修改错位到裁剪区下方', async () => {
    const sharp = await loadSharp()
    const width = 96
    const height = 80
    const source = await sharp({
      create: { width, height, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } },
    }).png().toBuffer()
    const maskPixels = Buffer.alloc(width * height * 4, 255)
    for (let y = 28; y < 40; y += 1) {
      for (let x = 34; x < 46; x += 1) {
        maskPixels[(y * width + x) * 4 + 3] = 0
      }
    }
    const mask = await sharp(maskPixels, {
      raw: { width, height, channels: 4 },
    }).png().toBuffer()
    const generated = await sharp({
      create: { width: 64, height: 64, channels: 4, background: { r: 240, g: 40, b: 20, alpha: 1 } },
    }).png().toBuffer()

    const result = await composeLocalRedraw({
      generatedSource: dataUrl(generated),
      context: {
        version: 2,
        requestId: 'compose-feathered-mask',
        source: dataUrl(source),
        mask: dataUrl(mask),
        sourceWidth: width,
        sourceHeight: height,
        crop: { x: 16, y: 8, width: 64, height: 64 },
        matchedAspectRatio: 1,
        settings: {
          contextScale: 2,
          aspectRatio: 'auto',
          registrationQuality: 'fast',
          featherPixels: 12,
          forceRegistration: false,
        },
      },
    })

    const encoded = vi.mocked(persistImageBytes).mock.calls.at(-1)?.[0]
    if (!encoded) throw new Error('测试输出未写入')
    const { data } = await sharp(encoded).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const selectedCenter = (34 * width + 40) * 4
    const cropBottom = (68 * width + 40) * 4
    const cropTopLeft = (10 * width + 18) * 4

    expect(data[selectedCenter]).toBeGreaterThan(100)
    expect(data[selectedCenter + 2]).toBeLessThan(30)
    expect([...data.subarray(cropBottom, cropBottom + 3)]).toEqual([10, 20, 30])
    expect([...data.subarray(cropTopLeft, cropTopLeft + 3)]).toEqual([10, 20, 30])
    expect(result.diagnostics.compositionChangeRetention).toBeGreaterThan(0.02)
  })

  it('透明源图只在蒙版内替换内容，不会把裁剪矩形整体改成不透明', async () => {
    const sharp = await loadSharp()
    const sourcePixels = Buffer.alloc(24 * 24 * 4)
    for (let pixel = 0; pixel < 24 * 24; pixel += 1) {
      sourcePixels[pixel * 4] = 10
      sourcePixels[pixel * 4 + 1] = 20
      sourcePixels[pixel * 4 + 2] = 30
      sourcePixels[pixel * 4 + 3] = 0
    }
    const source = await sharp(sourcePixels, { raw: { width: 24, height: 24, channels: 4 } }).png().toBuffer()
    const maskPixels = Buffer.alloc(24 * 24 * 4, 255)
    for (let y = 8; y < 16; y += 1) for (let x = 8; x < 16; x += 1) maskPixels[(y * 24 + x) * 4 + 3] = 0
    const mask = await sharp(maskPixels, { raw: { width: 24, height: 24, channels: 4 } }).png().toBuffer()
    const generated = await sharp({ create: { width: 24, height: 24, channels: 4, background: { r: 220, g: 40, b: 30, alpha: 1 } } }).png().toBuffer()

    await composeLocalRedraw({
      generatedSource: dataUrl(generated),
      context: {
        version: 2,
        requestId: 'compose-transparent',
        source: dataUrl(source),
        mask: dataUrl(mask),
        sourceWidth: 24,
        sourceHeight: 24,
        crop: { x: 0, y: 0, width: 24, height: 24 },
        matchedAspectRatio: 1,
        settings: { contextScale: 2, aspectRatio: 'auto', registrationQuality: 'fast', featherPixels: 0, forceRegistration: false },
      },
    })

    const encoded = vi.mocked(persistImageBytes).mock.calls.at(-1)?.[0]
    if (!encoded) throw new Error('测试输出未写入')
    const { data } = await sharp(encoded).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    expect(data[3]).toBe(0)
    expect(data[(12 * 24 + 12) * 4 + 3]).toBe(255)
  })

  it('模型结果在选区内没有产生可见变化时明确报错', async () => {
    const sharp = await loadSharp()
    const source = await sharp({ create: { width: 32, height: 32, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } } }).png().toBuffer()
    const maskPixels = Buffer.alloc(32 * 32 * 4, 255)
    for (let y = 8; y < 24; y += 1) for (let x = 8; x < 24; x += 1) maskPixels[(y * 32 + x) * 4 + 3] = 0
    const mask = await sharp(maskPixels, { raw: { width: 32, height: 32, channels: 4 } }).png().toBuffer()

    await expect(composeLocalRedraw({
      generatedSource: dataUrl(source),
      context: {
        version: 2,
        requestId: 'compose-no-change',
        source: dataUrl(source),
        mask: dataUrl(mask),
        sourceWidth: 32,
        sourceHeight: 32,
        crop: { x: 0, y: 0, width: 32, height: 32 },
        matchedAspectRatio: 1,
        settings: { contextScale: 2, aspectRatio: 'auto', registrationQuality: 'fast', featherPixels: 0, forceRegistration: false },
      },
    })).rejects.toThrow('没有产生可见变化')
  })
})
