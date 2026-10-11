import { afterEach, expect, it, vi } from 'vitest'
import { prepareSemanticImage } from './creativeIntentImages'
import type { VisualEvidence } from '@/core/creativeIntent/schema'

afterEach(() => { vi.unstubAllGlobals() })
it('裁取原受管拼图中的证据帧、缩放坐标，并在编码失败时释放位图', async () => {
  const close = vi.fn(), bitmap = { width: 1920, height: 1080, close }
  const drawImage = vi.fn(), convertToBlob = vi.fn(async () => new Blob([new Uint8Array([1, 2, 3])]))
  const dimensions: number[][] = []
  vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap))
  vi.stubGlobal('OffscreenCanvas', class {
    constructor(width: number, height: number) { dimensions.push([width, height]) }
    getContext() { return { drawImage } }
    convertToBlob = convertToBlob
  })
  const digest = `sha256:${'a'.repeat(64)}`
  const visual: VisualEvidence = { id: 'sheet', kind: 'frame', resourceRef: { resourceId: 'managed-image', digest, bytes: 3 }, size: [1920, 1080], pixelBudget: 2500000,
    frames: [{ eventId: 'pointer', seq: 1, monoUs: 1, timeline: null, unavailableReason: 'static', clockSegmentRef: 'clock', stateDigest: digest,
      geometrySnapshotRef: 'geometry', sourceRefs: [], pointer: [.5, .5], reason: 'pointing', attachmentRect: [960, 0, 960, 540] }] }
  const result = await prepareSemanticImage(new Uint8Array([1, 2, 3]), visual)
  expect(dimensions).toEqual([[640, 360]])
  expect(drawImage).toHaveBeenCalledWith(bitmap, 960, 0, 960, 540, 0, 0, 640, 360)
  expect(result.manifest.frames[0]).toMatchObject({ attachmentRect: [0, 0, 640, 360], pointer: [.5, .5] })
  expect(result.data).toBe('AQID')
  expect(visual.frames[0].attachmentRect).toEqual([960, 0, 960, 540])
  convertToBlob.mockRejectedValueOnce(new Error('encoder unavailable'))
  await expect(prepareSemanticImage(new Uint8Array([1]), visual)).rejects.toThrow('encoder unavailable')
  expect(close).toHaveBeenCalledTimes(2)
})
