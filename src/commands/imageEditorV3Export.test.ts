import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ImageEditorV3Platform } from '@/platform/contracts/imageEditorV3'

const mocks = vi.hoisted(() => ({ getPlatform: vi.fn() }))
vi.mock('@/platform/runtime', () => ({ getPlatform: mocks.getPlatform }))

import { exportImageEditorV3Raster } from './imageEditorV3Export'

const DOCUMENT_REF = 'image-edit-v3:export-document' as const
const FINGERPRINT = `sha256:${'a'.repeat(64)}` as const
const SESSION_ID = '123e4567-e89b-42d3-a456-426614174000'

function createPlatform(): ImageEditorV3Platform {
  return {
    loadDocument: vi.fn(async () => null),
    saveDocument: vi.fn(),
    importSource: vi.fn(),
    ingestSource: vi.fn(),
    readSourceMetadata: vi.fn(),
    describeSourcePyramid: vi.fn(),
    prewarmSourcePyramid: vi.fn(),
    readFastProxy: vi.fn(),
    readSourceTile: vi.fn(),
    persistBrushTiles: vi.fn(),
    readBrushTiles: vi.fn(),
    openPackage: vi.fn(),
    savePackageAs: vi.fn(),
    startRasterExport: vi.fn(async () => ({
      status: 'completed' as const,
      value: {
        sessionId: SESSION_ID,
        documentRef: DOCUMENT_REF,
        revision: 5,
        sourceFingerprint: FINGERPRINT,
        format: 'png8' as const,
      },
    })),
    writeRasterExportTile: vi.fn(async () => ({ written: true as const })),
    completeRasterExport: vi.fn(async () => ({
      outputRef: 'image-export-v3:export-document@5:png8' as const,
      documentRef: DOCUMENT_REF,
      revision: 5,
      sourceFingerprint: FINGERPRINT,
      format: 'png8' as const,
      width: 2,
      height: 1,
    })),
    cancelRasterExport: vi.fn(async () => ({ cancelled: true })),
    collectGarbage: vi.fn(),
    cancelRequest: vi.fn(async () => ({ cancelled: true })),
  }
}

const baseRequest = {
  documentRef: DOCUMENT_REF,
  revision: 5,
  sourceFingerprint: FINGERPRINT,
  format: 'png8' as const,
  description: {
    width: 2,
    height: 1,
    bitDepth: 8 as const,
    sampleFormat: 'uint' as const,
    colorSpace: 'srgb' as const,
    transferFunction: 'srgb' as const,
    alphaMode: 'straight' as const,
  },
}

beforeEach(() => {
  mocks.getPlatform.mockReset()
})

describe('图片编辑 V3 栅格导出命令', () => {
  it('用一次上层调用按顺序流式提交瓦片并完成原子输出', async () => {
    const platform = createPlatform()
    mocks.getPlatform.mockReturnValue({ imageEditorV3: platform })
    async function* tiles() {
      yield { x: 0, y: 0, width: 1, height: 1, rowStride: 4, pixels: Uint8Array.from([1, 2, 3, 4]) }
      yield { x: 1, y: 0, width: 1, height: 1, rowStride: 4, pixels: Uint8Array.from([5, 6, 7, 8]) }
    }

    await expect(exportImageEditorV3Raster({ ...baseRequest, tiles: tiles() })).resolves.toMatchObject({
      status: 'completed',
      value: { outputRef: 'image-export-v3:export-document@5:png8' },
    })
    expect(platform.startRasterExport).toHaveBeenCalledWith(expect.objectContaining({
      documentRef: DOCUMENT_REF,
      revision: 5,
      sourceFingerprint: FINGERPRINT,
    }))
    expect(vi.mocked(platform.startRasterExport).mock.calls[0]?.[0]).not.toHaveProperty('targetPath')
    expect(platform.writeRasterExportTile).toHaveBeenCalledTimes(2)
    expect(vi.mocked(platform.writeRasterExportTile).mock.calls.map(([request]) => request.tile.x))
      .toEqual([0, 1])
    expect(platform.completeRasterExport).toHaveBeenCalledWith({ sessionId: SESSION_ID })
    expect(platform.cancelRasterExport).not.toHaveBeenCalled()
  })

  it('用户取消保存对话框时不启动瓦片求值', async () => {
    const platform = createPlatform()
    platform.startRasterExport = vi.fn(async () => ({ status: 'cancelled' as const }))
    mocks.getPlatform.mockReturnValue({ imageEditorV3: platform })
    let iterated = false
    async function* tiles() {
      iterated = true
      yield { x: 0, y: 0, width: 2, height: 1, rowStride: 8, pixels: new ArrayBuffer(8) }
    }

    await expect(exportImageEditorV3Raster({ ...baseRequest, tiles: tiles() }))
      .resolves.toEqual({ status: 'cancelled' })
    expect(iterated).toBe(false)
    expect(platform.writeRasterExportTile).not.toHaveBeenCalled()
  })

  it('流式阶段失败或取消时清理主进程会话', async () => {
    const platform = createPlatform()
    platform.writeRasterExportTile = vi.fn(async () => {
      const error = new Error('renderer stopped')
      error.name = 'AbortError'
      throw error
    })
    mocks.getPlatform.mockReturnValue({ imageEditorV3: platform })

    await expect(exportImageEditorV3Raster({
      ...baseRequest,
      tiles: [{ x: 0, y: 0, width: 2, height: 1, rowStride: 8, pixels: new ArrayBuffer(8) }],
    })).rejects.toMatchObject({ name: 'AbortError' })
    expect(platform.cancelRasterExport).toHaveBeenCalledWith({ sessionId: SESSION_ID })
    expect(platform.completeRasterExport).not.toHaveBeenCalled()
  })
})
