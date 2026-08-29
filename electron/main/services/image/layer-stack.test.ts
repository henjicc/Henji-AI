import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./path-utils', async (importOriginal) => {
  const original = await importOriginal<typeof import('./path-utils')>()
  return {
    ...original,
    persistImageBytesTracked: vi.fn((bytes: Buffer, extension: string) => ({
      filePath: `/managed/${createHash('md5').update(bytes).digest('hex')}.${extension}`,
      created: true,
    })),
    rollbackPersistedImageBytes: vi.fn(),
  }
})

import { composeLayerStack } from './layer-stack'
import { persistImageBytesTracked, rollbackPersistedImageBytes } from './path-utils'
import { loadSharp } from './sharp-loader'

function dataUrl(mime: string, bytes: Buffer): string {
  return `data:${mime};base64,${bytes.toString('base64')}`
}

describe('composeLayerStack', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('验证 MIME/alpha/尺寸/hash 并按 bbox 合成底图与透明层', async () => {
    const sharp = await loadSharp()
    const base = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 20, g: 30, b: 40 } } }).jpeg().toBuffer()
    const layer = await sharp({ create: { width: 3, height: 2, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } } }).png().toBuffer()
    const result = await composeLayerStack({
      requestId: 'compose-success',
      stackId: 'stack-1',
      thumbnailMaxSize: 4,
      layers: [
        { sourceOutputIndex: 0, source: dataUrl('image/jpeg', base), zIndex: 0, role: 'base', declaredWidth: 8, declaredHeight: 8, declaredFormat: 'jpeg' },
        { sourceOutputIndex: 1, source: dataUrl('image/png', layer), zIndex: 1, role: 'content', declaredWidth: 3, declaredHeight: 2, declaredFormat: 'png', boundingBox: { absolute: [2, 3, 5, 5] }, opacity: 0.6 },
      ],
    })
    expect(result).toMatchObject({ stackId: 'stack-1', canvasWidth: 8, canvasHeight: 8 })
    expect(result.resources).toHaveLength(2)
    expect(result.resources[1]).toMatchObject({ hasAlpha: true, mimeType: 'image/png', placement: { x: 2, y: 3, width: 3, height: 2 } })
    expect(result.resources.every((item) => item.sha256.length === 64)).toBe(true)
    expect(result.compositePath).toMatch(/\.png$/)
    expect(result.thumbnailPath).toMatch(/\.webp$/)
    expect(result.createdFilePaths).toHaveLength(4)
  })

  it('重新合成复用受管输入层，只落盘新的合成图和缩略图', async () => {
    const sharp = await loadSharp()
    const base = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 20, g: 30, b: 40 } } }).jpeg().toBuffer()
    const source = dataUrl('image/jpeg', base)
    const result = await composeLayerStack({
      requestId: 'compose-reuse',
      stackId: 'stack-reuse',
      persistSourceLayers: false,
      layers: [{ sourceOutputIndex: 0, source, zIndex: 0, role: 'base', declaredWidth: 4, declaredHeight: 4, declaredFormat: 'jpeg' }],
    })
    expect(result.resources[0]?.filePath).toBe(source)
    expect(result.createdFilePaths).toHaveLength(2)
    expect(persistImageBytesTracked).toHaveBeenCalledTimes(2)
  })

  it('拒绝无 alpha 内容层、响应尺寸偏差与 bbox 偏差', async () => {
    const sharp = await loadSharp()
    const base = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 0, g: 0, b: 0 } } }).jpeg().toBuffer()
    const opaquePng = await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 255, g: 0, b: 0 } } }).png().toBuffer()
    const baseLayer = { sourceOutputIndex: 0, source: dataUrl('image/jpeg', base), zIndex: 0, role: 'base' as const, declaredWidth: 8, declaredHeight: 8, declaredFormat: 'jpeg' as const }
    const content = { sourceOutputIndex: 1, source: dataUrl('image/png', opaquePng), zIndex: 1, role: 'content' as const, declaredWidth: 2, declaredHeight: 2, declaredFormat: 'png' as const, boundingBox: { absolute: [0, 0, 2, 2] as [number, number, number, number] } }
    await expect(composeLayerStack({ requestId: 'compose-alpha', stackId: 'alpha', layers: [baseLayer, content] })).rejects.toThrow(/透明通道/)
    await expect(composeLayerStack({ requestId: 'compose-size', stackId: 'size', layers: [{ ...baseLayer, declaredWidth: 12 }] })).rejects.toThrow(/尺寸/)
    const transparent = await sharp(opaquePng).ensureAlpha(0.5).png().toBuffer()
    await expect(composeLayerStack({ requestId: 'compose-bbox', stackId: 'bbox', layers: [baseLayer, { ...content, source: dataUrl('image/png', transparent), boundingBox: { absolute: [0, 0, 6, 6] } }] })).rejects.toThrow(/偏差/)
  })

  it('取消信号在像素工作前终止', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(composeLayerStack({ requestId: 'compose-cancel', stackId: 'cancel', layers: [{ sourceOutputIndex: 0, source: 'unused', zIndex: 0, role: 'base', declaredWidth: 1, declaredHeight: 1, declaredFormat: 'png' }] }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('所有像素校验通过后才落盘，落盘阶段失败会回滚本次新文件', async () => {
    const sharp = await loadSharp()
    const base = await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 0, g: 0, b: 0 } } }).jpeg().toBuffer()
    vi.mocked(persistImageBytesTracked)
      .mockImplementationOnce(() => ({ filePath: '/managed/base.jpg', created: true }))
      .mockImplementationOnce(() => { throw new Error('磁盘已满') })
    await expect(composeLayerStack({
      requestId: 'compose-rollback',
      stackId: 'rollback',
      layers: [{ sourceOutputIndex: 0, source: dataUrl('image/jpeg', base), zIndex: 0, role: 'base', declaredWidth: 2, declaredHeight: 2, declaredFormat: 'jpeg' }],
    })).rejects.toThrow(/磁盘已满/)
    expect(rollbackPersistedImageBytes).toHaveBeenCalledWith({ filePath: '/managed/base.jpg', created: true })
  })
})
