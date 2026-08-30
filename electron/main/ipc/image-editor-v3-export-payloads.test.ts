import { describe, expect, it } from 'vitest'

import {
  parseImageEditorV3RasterExportSessionPayload,
  parseImageEditorV3StartRasterExportPayload,
  parseImageEditorV3WriteRasterExportTilePayload,
} from './image-editor-v3-export-payloads'

const SESSION_ID = '123e4567-e89b-42d3-a456-426614174000'
const SOURCE_FINGERPRINT = `sha256:${'a'.repeat(64)}`

function startPayload(): Record<string, unknown> {
  return {
    requestId: 'image-editor-v3:raster-export:test',
    documentRef: 'image-edit-v3:export-document',
    revision: 8,
    sourceFingerprint: SOURCE_FINGERPRINT,
    format: 'bigtiff',
    suggestedName: 'large-image',
    tileSize: 512,
    compressionLevel: 6,
    description: {
      width: 20_000,
      height: 10_000,
      bitDepth: 16,
      sampleFormat: 'uint',
      colorSpace: 'display-p3',
      transferFunction: 'linear',
      alphaMode: 'straight',
      iccProfileResourceRef: `sha256:${'b'.repeat(64)}`,
    },
  }
}

describe('图片编辑 V3 栅格导出 IPC 输入', () => {
  it('接受 200MP 有界快照参数，且输出路径不属于渲染层契约', () => {
    const parsed = parseImageEditorV3StartRasterExportPayload(startPayload())
    expect(parsed).toMatchObject({
      documentRef: 'image-edit-v3:export-document',
      revision: 8,
      sourceFingerprint: SOURCE_FINGERPRINT,
      format: 'bigtiff',
      tileSize: 512,
      description: {
        width: 20_000,
        height: 10_000,
        channels: 4,
        bitDepth: 16,
        iccProfileResourceId: `sha256:${'b'.repeat(64)}`,
      },
    })
    expect(parsed).not.toHaveProperty('targetPath')
    expect(() => parseImageEditorV3StartRasterExportPayload({
      ...startPayload(),
      targetPath: '/tmp/injected.tif',
    })).toThrow('unsupported fields: targetPath')
  })

  it('拒绝无界尺寸、伪造指纹、未知格式和被静默忽略的字段', () => {
    expect(() => parseImageEditorV3StartRasterExportPayload({
      ...startPayload(),
      description: { ...(startPayload().description as object), width: 40_001, height: 10_000 },
    })).toThrow('exceeds 400000000 pixels')
    expect(() => parseImageEditorV3StartRasterExportPayload({
      ...startPayload(),
      sourceFingerprint: 'sha256:not-valid',
    })).toThrow('Invalid sourceFingerprint')
    expect(() => parseImageEditorV3StartRasterExportPayload({
      ...startPayload(),
      format: 'psd',
    })).toThrow('Invalid raster export format')
    expect(() => parseImageEditorV3StartRasterExportPayload({
      ...startPayload(),
      description: { ...(startPayload().description as object), channels: 3 },
    })).toThrow('unsupported fields: channels')
  })

  it('只接受 UUID 会话和不超过 16MiB 的精确瓦片缓冲', () => {
    expect(parseImageEditorV3RasterExportSessionPayload({ sessionId: SESSION_ID }))
      .toEqual({ sessionId: SESSION_ID })
    const pixels = new Uint8Array(512 * 2 * 4)
    expect(parseImageEditorV3WriteRasterExportTilePayload({
      sessionId: SESSION_ID,
      tile: { x: 0, y: 0, width: 512, height: 2, rowStride: 2_048, pixels: pixels.buffer },
    }).tile.pixels.byteLength).toBe(pixels.byteLength)
    expect(() => parseImageEditorV3WriteRasterExportTilePayload({
      sessionId: SESSION_ID,
      tile: { x: 0, y: 0, width: 512, height: 2, rowStride: 2_048, pixels: new ArrayBuffer(1) },
    })).toThrow('does not match its row layout')
    expect(() => parseImageEditorV3RasterExportSessionPayload({ sessionId: '../foreign' }))
      .toThrow('Invalid raster export sessionId')
  })
})
