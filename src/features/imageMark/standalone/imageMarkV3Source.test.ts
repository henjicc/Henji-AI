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

  it('保留 SDR 位深、P3 与 ICC 引用', () => {
    const icc = `sha256:${'b'.repeat(64)}` as const
    expect(createImageMarkV3ColorMode(metadata({
      bitsPerSample: 16,
      depth: 'ushort',
      colorSpace: 'display-p3',
      hasIccProfile: true,
      iccProfileResourceRef: icc,
    }))).toEqual({
      workingSpace: 'display-p3',
      bitDepth: 16,
      transferFunction: 'srgb',
      hdrMetadata: null,
      iccProfileResourceId: icc,
    })
  })

  it('按 CICP 显式建立 PQ 与 HLG 文档而不降成 8 位', () => {
    const pq = createImageMarkV3ColorMode(metadata({
      format: 'avif',
      bitsPerSample: 10,
      cicp: {
        colorPrimaries: 9,
        transferCharacteristics: 16,
        matrixCoefficients: 9,
        fullRange: true,
      },
      hdr: true,
    }))
    expect(pq).toMatchObject({
      workingSpace: 'rec2020',
      bitDepth: 16,
      transferFunction: 'pq',
      hdrMetadata: { standard: 'pq' },
    })

    const hlg = createImageMarkV3ColorMode(metadata({
      bitsPerSample: 10,
      cicp: {
        colorPrimaries: 9,
        transferCharacteristics: 18,
        matrixCoefficients: 9,
        fullRange: false,
      },
    }))
    expect(hlg).toMatchObject({
      workingSpace: 'rec2020',
      bitDepth: 16,
      transferFunction: 'hlg',
      hdrMetadata: { standard: 'hlg' },
    })
  })
})
