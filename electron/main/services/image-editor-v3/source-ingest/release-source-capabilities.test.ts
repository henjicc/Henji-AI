import { describe, expect, it } from 'vitest'

import type { SourceImageMetadata } from '../contracts'
import {
  assertImageEditorV3ReleaseSource,
  ImageEditorV3UnsupportedSourceError,
} from './release-source-capabilities'

function metadata(patch: Partial<SourceImageMetadata> = {}): SourceImageMetadata {
  return {
    resourceId: `sha256:${'a'.repeat(64)}`,
    width: 4_000,
    height: 3_000,
    encodedWidth: 4_000,
    encodedHeight: 3_000,
    format: 'jpeg',
    depth: 'uchar',
    bitsPerSample: 8,
    orientation: 1,
    orientationApplied: true,
    pages: 1,
    hasAlpha: false,
    hasIccProfile: false,
    cicp: null,
    hdr: false,
    ...patch,
  }
}

describe('图片编辑 V3 实际解码源格式门禁', () => {
  it.each(['jpeg', 'png', 'webp', 'tiff', 'avif', 'heif'])('接受静态 SDR %s 并保留 16 位', (format) => {
    expect(() => assertImageEditorV3ReleaseSource(metadata({ format, bitsPerSample: 16, depth: 'ushort' }))).not.toThrow()
  })

  it.each([
    [{ format: 'unknown' }, 'format'],
    [{ cicp: { colorPrimaries: 9, transferCharacteristics: 1, matrixCoefficients: 9, fullRange: false } }, 'format'],
    [{ hdr: true }, 'hdr'],
    [{ pages: 2 }, 'animated'],
  ] as const)('拒绝未经验证的颜色或多页来源 %#', (patch, reason) => {
    expect(() => assertImageEditorV3ReleaseSource(metadata(patch))).toThrow(
      expect.objectContaining({ name: ImageEditorV3UnsupportedSourceError.name, reason }),
    )
  })
})
