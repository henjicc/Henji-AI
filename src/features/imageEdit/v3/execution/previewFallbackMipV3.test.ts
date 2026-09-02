import { describe, expect, it } from 'vitest'

import { resolveImageEditorCoarsePreviewMipV3 } from './previewFallbackMipV3'

describe('resolveImageEditorCoarsePreviewMipV3', () => {
  it.each([
    [{ width: 800, height: 600 }, 0],
    [{ width: 1_600, height: 1_000 }, 1],
    [{ width: 6_000, height: 4_000 }, 3],
    [{ width: 20_000, height: 10_000 }, 5],
    [{ width: 200_000, height: 1_000 }, 8],
  ] as const)('为 %o 选择可辨认且有界的整图 mip', (size, expected) => {
    expect(resolveImageEditorCoarsePreviewMipV3(size)).toBe(expected)
    const longestEdge = Math.max(size.width, size.height) / (2 ** expected)
    expect(longestEdge).toBeLessThanOrEqual(1_024)
    if (expected > 0) expect(longestEdge).toBeGreaterThan(512)
  })
})
