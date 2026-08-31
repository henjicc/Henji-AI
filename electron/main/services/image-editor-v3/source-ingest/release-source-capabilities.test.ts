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

describe('图片编辑 V3 候选版源格式门禁', () => {
  it.each(['jpeg', 'png', 'webp'])('接受静态 8-bit SDR %s', (format) => {
    expect(() => assertImageEditorV3ReleaseSource(metadata({ format }))).not.toThrow()
  })

  it.each([
    [{ format: 'avif' }, 'format'],
    [{ bitsPerSample: 16, depth: 'ushort' }, 'precision'],
    [{ hdr: true }, 'hdr'],
    [{ pages: 2 }, 'animated'],
  ] as const)('拒绝候选版范围外来源 %#', (patch, reason) => {
    expect(() => assertImageEditorV3ReleaseSource(metadata(patch))).toThrow(
      expect.objectContaining({ name: ImageEditorV3UnsupportedSourceError.name, reason }),
    )
  })
})
