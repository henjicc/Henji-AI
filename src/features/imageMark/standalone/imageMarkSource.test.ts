import { describe, expect, it, vi } from 'vitest'

import type { ImageEditorV3SourceMetadata } from '@/platform/contracts/imageEditorV3'
import {
  createImageMarkColorMode,
  resolveImageMarkSourceLocator,
  prepareImageEditSourceLocator,
} from './imageMarkSource'

const sourceIO = vi.hoisted(() => ({ persist: vi.fn() }))
vi.mock('@/commands/image', async importOriginal => ({ ...await importOriginal<typeof import('@/commands/image')>(), persistImageSource: sourceIO.persist }))

const RESOURCE_REF = `sha256:${'a'.repeat(64)}` as const

function metadata(
  patch: Partial<ImageEditorV3SourceMetadata> = {},
): ImageEditorV3SourceMetadata {
  return {
    resourceRef: RESOURCE_REF,
    width: 4_000,
    height: 3_000,
    encodedWidth: 4_000,
    encodedHeight: 3_000,
    format: 'png',
    channels: 4,
    depth: 'uchar',
    bitsPerSample: 8,
    colorSpace: 'srgb',
    orientation: 1,
    orientationApplied: true,
    density: 72,
    pages: 1,
    hasAlpha: true,
    hasIccProfile: false,
    iccProfileResourceRef: null,
    cicp: null,
    hdr: false,
    ...patch,
  }
}

describe('imageMarkSource', () => {
  it('文件 URL 解码为主进程路径，不透明媒体只经正式持久化边界解析', async () => {
    expect(await prepareImageEditSourceLocator('file:///C:/图片/a.png')).toEqual({ kind: 'local-path', filePath: 'C:/图片/a.png' })
    sourceIO.persist.mockResolvedValue('C:/managed/a.png')
    expect(await prepareImageEditSourceLocator('henji-media://image-editor-v3/source')).toEqual({ kind: 'local-path', filePath: 'C:/managed/a.png' })
    expect(sourceIO.persist).toHaveBeenCalledWith('henji-media://image-editor-v3/source')
  })
  it('只把主进程支持的三类来源送入受管导入', () => {
    expect(resolveImageMarkSourceLocator('/private/tmp/source.png')).toEqual({
      kind: 'local-path',
      filePath: '/private/tmp/source.png',
    })
    expect(resolveImageMarkSourceLocator('data:image/png;base64,AA==')).toEqual({
      kind: 'data-url',
      dataUrl: 'data:image/png;base64,AA==',
    })
    expect(resolveImageMarkSourceLocator('https://example.com/source.png')).toEqual({
      kind: 'http-url',
      url: 'https://example.com/source.png',
    })
    expect(() => resolveImageMarkSourceLocator('henji-media://source.png')).toThrow(
      '还不能导入新版编辑器',
    )
  })

  it('P3 输入以 Float32 线性 sRGB 工作，保留超白和负通道而不误附原 ICC', () => {
    const icc = `sha256:${'b'.repeat(64)}` as const
    expect(createImageMarkColorMode(metadata({
      colorSpace: 'display-p3',
      hasIccProfile: true,
      iccProfileResourceRef: icc,
    }))).toEqual({
      workingSpace: 'srgb',
      bitDepth: 'float32',
      transferFunction: 'linear',
      hdrMetadata: null,
      iccProfileResourceId: null,
    })
  })

  it('保留 16 位与浮点精度，拒绝未验证的 HDR 解码', () => {
    expect(createImageMarkColorMode(metadata({ bitsPerSample: 16, depth: 'ushort' }))).toMatchObject({ bitDepth: 16, transferFunction: 'srgb' })
    expect(createImageMarkColorMode(metadata({ bitsPerSample: 32, depth: 'float' }))).toMatchObject({ bitDepth: 'float32', transferFunction: 'linear' })
    expect(() => createImageMarkColorMode(metadata({ format: 'avif', bitsPerSample: 10, cicp: { colorPrimaries: 9, transferCharacteristics: 16, matrixCoefficients: 9, fullRange: true }, hdr: true }))).toThrow('颜色保真验证')
    expect(() => createImageMarkColorMode(metadata({ hdr: true }))).toThrow('颜色保真验证')
    expect(() => createImageMarkColorMode(metadata({ pages: 2 }))).toThrow('多页图片')
  })
})
