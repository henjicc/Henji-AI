/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'
import { useImageEditorLayerPickingV3 } from './useImageEditorLayerPickingV3'

const reader = vi.hoisted(() => ({ metadata: vi.fn(), tile: vi.fn(), brush: vi.fn() }))
vi.mock('@/commands/imageEditorV3', () => ({
  createImageEditorV3RequestId: () => 'pick-test',
  readImageEditorV3SourceMetadata: reader.metadata,
  readImageEditorV3SourceTile: reader.tile,
  readImageEditorV3BrushTiles: reader.brush,
}))
const ref = `sha256:${'a'.repeat(64)}` as const
const descriptors = [{ resourceRef: ref, byteLength: 400, mediaType: 'image/png' }]

describe('图层命中资源生命周期', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reader.metadata.mockResolvedValue({ width: 2048, height: 1024, hasAlpha: true })
    const pixels = new Uint8Array(512 * 256 * 4)
    pixels[(20 * 512 + 10) * 4 + 3] = 255
    reader.tile.mockResolvedValue({ width: 512, height: 256, bitDepth: 8, pixels: pixels.buffer })
  })
  afterEach(cleanup)

  it('只读取有界 mip 并映射到真实源尺寸，变换与 revision 不触发重复读取', async () => {
    const document = createImageEditDocumentV3({ width: 960, height: 640, sourceResourceId: ref })
    const { result, rerender } = renderHook(({ doc }) => useImageEditorLayerPickingV3(doc, descriptors), { initialProps: { doc: document } })
    await waitFor(() => expect(result.current.size).toBe(1))
    expect(reader.tile.mock.calls[0][0]).toMatchObject({ mip: 2, tileX: 0, tileY: 0, bitDepth: 8 })
    expect(result.current.get(ref)?.bounds).toEqual({ x: 40, y: 80, width: 4, height: 4 })
    rerender({ doc: { ...document, revision: 1, layers: document.layers.map((layer) => ({ ...layer, transform: [1, 0, 0, 1, 20, 30] })) } })
    expect(reader.metadata).toHaveBeenCalledTimes(1)
    expect(reader.tile).toHaveBeenCalledTimes(1)
  })

  it('旧式不透明灰度蒙版读取亮度，不将其误判为全白 Alpha', async () => {
    reader.metadata.mockResolvedValue({ width: 2, height: 1, hasAlpha: false })
    reader.tile.mockResolvedValue({ width: 2, height: 1, bitDepth: 8,
      pixels: new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]).buffer })
    const document = createImageEditDocumentV3({ width: 2, height: 1, sourceResourceId: ref })
    document.layers[0].mask = { resourceId: ref, inverted: false }
    const { result } = renderHook(() => useImageEditorLayerPickingV3(document, descriptors))
    await waitFor(() => expect(result.current.size).toBe(2))
    expect(result.current.get(ref)?.alpha).toEqual(new Uint8Array([255]))
    expect(result.current.get(`mask:${ref}`)?.alpha).toEqual(new Uint8Array([0, 255]))
  })

  it('删除资源后迟到的读取不会重新写入新文档缓存', async () => {
    let finish: (value: { width: number; height: number; hasAlpha: boolean }) => void = () => undefined
    reader.metadata.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const document = createImageEditDocumentV3({ width: 100, height: 100, sourceResourceId: ref })
    const { result, rerender } = renderHook(({ doc }) => useImageEditorLayerPickingV3(doc, descriptors), { initialProps: { doc: document } })
    rerender({ doc: { ...document, layers: [] } })
    await act(async () => { finish({ width: 100, height: 100, hasAlpha: false }) })
    expect(result.current.size).toBe(0)
    expect(reader.metadata.mock.calls[0][1].aborted).toBe(true)
  })
})
