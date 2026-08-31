import { describe, expect, it } from 'vitest'

import { IMAGE_EDITOR_V3_HDR_AVIF_MAX_PIXELS } from '../../../../../src/platform/contracts/imageEditorV3'
import type { TileOutputDescription } from '../contracts'
import { prepareExportMetadata } from './capabilities'

function pqDescription(width: number, height: number): TileOutputDescription {
  return {
    width,
    height,
    channels: 4,
    bitDepth: 16,
    sampleFormat: 'uint',
    colorSpace: 'rec2020',
    transferFunction: 'pq',
    alphaMode: 'straight',
    cicp: {
      colorPrimaries: 9,
      transferCharacteristics: 16,
      matrixCoefficients: 9,
      fullRange: false,
    },
    documentId: 'hdr-capability-boundary',
    revision: 1,
    sourceFingerprint: 'sha256:hdr-capability-boundary',
  }
}

describe('HDR AVIF 编码资源门槛', () => {
  it('与 renderer 共用 900 万像素契约，并在越界时于编码器启动前拒绝', async () => {
    expect(IMAGE_EDITOR_V3_HDR_AVIF_MAX_PIXELS).toBe(9_000_000)
    await expect(prepareExportMetadata(pqDescription(3_000, 3_000), {
      format: 'avif10',
      inputByteOrder: 'little-endian',
    })).resolves.toEqual({})

    await expect(prepareExportMetadata(pqDescription(3_001, 3_000), {
      format: 'avif10',
      inputByteOrder: 'little-endian',
    })).rejects.toMatchObject({
      code: 'ENCODER_RESOURCE_LIMIT',
      format: 'avif10',
    })
  })
})
