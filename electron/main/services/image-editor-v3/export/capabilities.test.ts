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

function hdrBigTiffDescription(): TileOutputDescription {
  return {
    width: 20_000,
    height: 10_000,
    channels: 4,
    bitDepth: 32,
    sampleFormat: 'float',
    colorSpace: 'rec2020',
    transferFunction: 'linear',
    alphaMode: 'straight',
    hdrBigTiffExchange: {
      schema: 'henji-hdr-bigtiff-v1',
      sourceTransferFunction: 'pq',
      referenceWhiteNits: 203,
      sourceCicp: {
        colorPrimaries: 9,
        transferCharacteristics: 16,
        matrixCoefficients: 9,
        fullRange: false,
      },
    },
    documentId: 'hdr-bigtiff-capability',
    revision: 1,
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

describe('HDR BigTIFF 交换契约', () => {
  it('允许 200MP 线性 Float32 分块输出，拒绝错误格式与伪造 CICP', async () => {
    const description = hdrBigTiffDescription()
    await expect(prepareExportMetadata(description, {
      format: 'bigtiff',
      inputByteOrder: 'little-endian',
    })).resolves.toEqual({})

    await expect(prepareExportMetadata(description, {
      format: 'png16',
      inputByteOrder: 'little-endian',
    })).rejects.toMatchObject({ code: 'SOURCE_PRECISION_UNSUPPORTED', format: 'png16' })
    await expect(prepareExportMetadata({
      ...description,
      hdrBigTiffExchange: {
        ...description.hdrBigTiffExchange!,
        sourceCicp: {
          ...description.hdrBigTiffExchange!.sourceCicp,
          transferCharacteristics: 18,
        },
      },
    }, {
      format: 'bigtiff',
      inputByteOrder: 'little-endian',
    })).rejects.toMatchObject({ code: 'INVALID_COLOR_METADATA', format: 'bigtiff' })
  })
})
