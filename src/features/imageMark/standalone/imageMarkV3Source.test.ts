import { describe, expect, it } from 'vitest'

import type { ImageEditorV3SourceMetadata } from '@/platform/contracts/imageEditorV3'
import {
  createImageMarkV3ColorMode,
  resolveImageMarkV3SourceLocator,
} from './imageMarkV3Source'

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

describe('imageMarkV3Source', () => {
  it('只把主进程支持的三类来源送入受管导入', () => {
    expect(resolveImageMarkV3SourceLocator('/private/tmp/source.png')).toEqual({
      kind: 'local-path',
      filePath: '/private/tmp/source.png',
    })
    expect(resolveImageMarkV3SourceLocator('data:image/png;base64,AA==')).toEqual({
      kind: 'data-url',
      dataUrl: 'data:image/png;base64,AA==',
    })
    expect(resolveImageMarkV3SourceLocator('https://example.com/source.png')).toEqual({
      kind: 'http-url',
      url: 'https://example.com/source.png',
    })
    expect(() => resolveImageMarkV3SourceLocator('henji-media://source.png')).toThrow(
      '还不能导入新版编辑器',
    )
  })

  it('候选版把支持的 8-bit SDR 来源统一为 sRGB 文档，不开放 ICC 模式', () => {
    const icc = `sha256:${'b'.repeat(64)}` as const
    expect(createImageMarkV3ColorMode(metadata({
      colorSpace: 'display-p3',
      hasIccProfile: true,
      iccProfileResourceRef: icc,
    }))).toEqual({
      workingSpace: 'srgb',
      bitDepth: 8,
      transferFunction: 'srgb',
      hdrMetadata: null,
      iccProfileResourceId: null,
    })
  })

  it('拒绝把 16 位、HDR 和非首发格式静默降成 8 位', () => {
    expect(() => createImageMarkV3ColorMode(metadata({
      bitsPerSample: 16,
      depth: 'ushort',
    }))).toThrow('仅支持 8-bit SDR')
    expect(() => createImageMarkV3ColorMode(metadata({
      format: 'avif',
      bitsPerSample: 10,
      cicp: {
        colorPrimaries: 9,
        transferCharacteristics: 16,
        matrixCoefficients: 9,
        fullRange: true,
      },
      hdr: true,
    }))).toThrow('仅支持 JPEG、PNG 和 WebP')
    expect(() => createImageMarkV3ColorMode(metadata({ hdr: true })))
      .toThrow('仅支持 8-bit SDR')
  })
})
