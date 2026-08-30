import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createImageEditDocumentV3,
  createImageEditRasterLayerV3,
} from '@/core/imageEdit/v3/documentFactory'
import { ImageEditCommandHistoryV3 } from '@/core/imageEdit/v3/commandHistory'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import { createFloat32MaskTile } from '@/core/imageEdit/v3/effects/contracts'
import type {
  ImageEditorV3DocumentRef,
  ImageEditorV3Platform,
} from '@/platform/contracts/imageEditorV3'

const mocks = vi.hoisted(() => ({ getPlatform: vi.fn() }))

vi.mock('@/platform/runtime', () => ({
  getPlatform: mocks.getPlatform,
  isDesktopRuntime: () => false,
}))

import {
  collectImageEditorV3ResourceRefs,
  ImageEditorV3CommandRepository,
  ingestImageEditorV3Source,
  persistImageEditorV3BrushTiles,
  readImageEditorV3BrushTiles,
  readImageEditorV3FastProxy,
} from './imageEditorV3'

const SOURCE_REF = `sha256:${'a'.repeat(64)}` as const
const ICC_REF = `sha256:${'b'.repeat(64)}` as const
const PREVIEW_REF = `sha256:${'c'.repeat(64)}` as const

function createPlatform(): ImageEditorV3Platform {
  return {
    loadDocument: vi.fn(async () => null),
    saveDocument: vi.fn(async (request) => ({
      documentRef: `image-edit-v3:${request.document.id}` as ImageEditorV3DocumentRef,
      revision: request.document.revision,
      previewRef: request.previewRef ?? null,
    })),
    importSource: vi.fn(async () => ({ status: 'cancelled' as const })),
    ingestSource: vi.fn(),
    readSourceMetadata: vi.fn(),
    describeSourcePyramid: vi.fn(),
    readFastProxy: vi.fn(),
    readSourceTile: vi.fn(),
    persistBrushTiles: vi.fn(),
    readBrushTiles: vi.fn(),
    openPackage: vi.fn(async () => ({ status: 'cancelled' as const })),
    savePackageAs: vi.fn(async () => ({ status: 'cancelled' as const })),
    startRasterExport: vi.fn(async () => ({ status: 'cancelled' as const })),
    writeRasterExportTile: vi.fn(async () => ({ written: true as const })),
    completeRasterExport: vi.fn(),
    cancelRasterExport: vi.fn(async () => ({ cancelled: true })),
    collectGarbage: vi.fn(async () => ({ deletedResourceRefs: [], reclaimedBytes: 0 })),
    cancelRequest: vi.fn(async () => ({ cancelled: true })),
  }
}

function createDocument(revision: number): ImageEditDocumentV3 {
  return {
    ...createImageEditDocumentV3({
      documentId: 'document-contract',
      width: 200,
      height: 100,
      sourceResourceId: SOURCE_REF,
    }),
    revision,
    color: {
      workingSpace: 'display-p3',
      bitDepth: 16,
      transferFunction: 'linear',
      hdrMetadata: null,
      iccProfileResourceId: ICC_REF,
    },
  }
}

beforeEach(() => {
  mocks.getPlatform.mockReset()
  mocks.getPlatform.mockReturnValue({ imageEditorV3: createPlatform() })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('图片编辑 V3 commands 契约', () => {
  it('只从文档内容收集内容寻址引用并包含预览资源', () => {
    expect(collectImageEditorV3ResourceRefs(createDocument(0), PREVIEW_REF)).toEqual([
      SOURCE_REF,
      ICC_REF,
      PREVIEW_REF,
    ].sort())
  })

  it('把连续命令合并为一次延迟保存，同时保留最早 CAS 基线', async () => {
    vi.useFakeTimers()
    const platform = createPlatform()
    mocks.getPlatform.mockReturnValue({ imageEditorV3: platform })
    const repository = new ImageEditorV3CommandRepository()

    repository.scheduleAutosave(createDocument(1), { expectedRevision: 0, previewRef: PREVIEW_REF })
    repository.scheduleAutosave(createDocument(2), { expectedRevision: 1, previewRef: PREVIEW_REF })
    await vi.advanceTimersByTimeAsync(500)

    expect(platform.saveDocument).toHaveBeenCalledOnce()
    expect(platform.saveDocument).toHaveBeenCalledWith(expect.objectContaining({
      document: expect.objectContaining({ revision: 2 }),
      expectedRevision: 0,
      resourceRefs: [SOURCE_REF, ICC_REF, PREVIEW_REF].sort(),
    }))
  })

  it('自动保存失败后保留最新文档并按原 CAS 基线重试', async () => {
    vi.useFakeTimers()
    const platform = createPlatform()
    vi.mocked(platform.saveDocument)
      .mockRejectedValueOnce(new Error('temporary disk failure'))
      .mockImplementation(async (request) => ({
        documentRef: `image-edit-v3:${request.document.id}` as ImageEditorV3DocumentRef,
        revision: request.document.revision,
        previewRef: request.previewRef ?? null,
      }))
    mocks.getPlatform.mockReturnValue({ imageEditorV3: platform })
    const repository = new ImageEditorV3CommandRepository()

    repository.scheduleAutosave(createDocument(1), { expectedRevision: 0 })
    await vi.advanceTimersByTimeAsync(500)
    repository.scheduleAutosave(createDocument(2), { expectedRevision: 1 })
    await vi.advanceTimersByTimeAsync(500)

    expect(platform.saveDocument).toHaveBeenCalledTimes(2)
    expect(platform.saveDocument).toHaveBeenLastCalledWith(expect.objectContaining({
      document: expect.objectContaining({ revision: 2 }),
      expectedRevision: 0,
    }))
  })

  it('保存和加载结构化历史，并把撤销栈独占资源并入 live refs', async () => {
    const platform = createPlatform()
    const initial: ImageEditDocumentV3 = {
      ...createImageEditDocumentV3({ width: 32, height: 32, documentId: 'history-command' }),
      layers: [createImageEditRasterLayerV3('paint', '画笔')],
    }
    const history = new ImageEditCommandHistoryV3()
    history.clear(initial)
    const painted = history.execute(initial, {
      type: 'raster.apply-tile-delta',
      commandId: 'command-paint',
      expectedRevision: 0,
      layerId: 'paint',
      changes: [{
        tileKey: '0:0:0',
        previousResourceId: null,
        previousByteSize: 0,
        resourceId: PREVIEW_REF,
        byteSize: 4,
      }],
    })
    const document = history.undo(painted).document
    const snapshot = history.createSnapshot()
    vi.mocked(platform.loadDocument).mockResolvedValue({
      documentRef: 'image-edit-v3:history-command',
      revision: document.revision,
      previewRef: null,
      document,
      history: snapshot,
      resourceRefs: [PREVIEW_REF],
      sourceFingerprint: `sha256:${'d'.repeat(64)}`,
    })
    mocks.getPlatform.mockReturnValue({ imageEditorV3: platform })
    const repository = new ImageEditorV3CommandRepository()

    await repository.save(document, {
      expectedRevision: document.revision,
      history: snapshot,
      previewRef: null,
    })
    expect(platform.saveDocument).toHaveBeenCalledWith(expect.objectContaining({
      history: snapshot,
      resourceRefs: [PREVIEW_REF],
    }))
    await expect(repository.load(document.id)).resolves.toMatchObject({ history: snapshot })
  })

  it('AbortSignal 通过 requestId 协作取消主进程任务', async () => {
    const platform = createPlatform()
    let rejectRequest: ((error: Error) => void) | undefined
    vi.mocked(platform.readFastProxy).mockImplementation(() => new Promise((_resolve, reject) => {
      rejectRequest = reject
    }))
    vi.mocked(platform.cancelRequest).mockImplementation(async () => {
      const error = new Error('cancelled')
      error.name = 'AbortError'
      rejectRequest?.(error)
      return { cancelled: true }
    })
    mocks.getPlatform.mockReturnValue({ imageEditorV3: platform })
    const controller = new AbortController()
    const pending = readImageEditorV3FastProxy({
      requestId: 'image-editor-v3:proxy:test',
      resourceRef: SOURCE_REF,
      maxDimension: 1_024,
    }, controller.signal)

    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(platform.cancelRequest).toHaveBeenCalledWith('image-editor-v3:proxy:test')
  })

  it('宿主来源导入只透传来源描述并返回受管引用', async () => {
    const platform = createPlatform()
    vi.mocked(platform.ingestSource).mockResolvedValue({
      resource: { resourceRef: SOURCE_REF, byteLength: 3, mediaType: 'image/png' },
      metadata: {
        resourceRef: SOURCE_REF,
        width: 1,
        height: 1,
        encodedWidth: 1,
        encodedHeight: 1,
        format: 'png',
        channels: 4,
        depth: 'uchar',
        bitsPerSample: 8,
        colorSpace: 'srgb',
        orientation: 1,
        orientationApplied: true,
        density: null,
        pages: 1,
        hasAlpha: true,
        hasIccProfile: false,
        iccProfileResourceRef: null,
        cicp: null,
        hdr: false,
      },
    })
    mocks.getPlatform.mockReturnValue({ imageEditorV3: platform })
    const request = {
      requestId: 'image-editor-v3:ingest:test',
      source: { kind: 'data-url' as const, dataUrl: 'data:image/png;base64,AQID' },
    }

    const result = await ingestImageEditorV3Source(request)

    expect(platform.ingestSource).toHaveBeenCalledWith(request)
    expect(result.resource.resourceRef).toBe(SOURCE_REF)
  })

  it('画笔命令在 PAL 边界复制 Float32 数据并映射内容寻址引用', async () => {
    const platform = createPlatform()
    vi.mocked(platform.persistBrushTiles).mockResolvedValue({
      tiles: [{ tileKey: '0:2:3', resource: { resourceRef: PREVIEW_REF, byteSize: 128 } }],
    })
    vi.mocked(platform.readBrushTiles).mockResolvedValue({
      tiles: [{
        tileKey: '0:2:3',
        tile: {
          storage: 'mask-float32',
          width: 2,
          height: 1,
          data: new Float32Array([0.25, 1]).buffer,
        },
      }],
    })
    mocks.getPlatform.mockReturnValue({ imageEditorV3: platform })
    const source = createFloat32MaskTile(2, 1, new Float32Array([0.25, 1]))

    const persisted = await persistImageEditorV3BrushTiles({
      requestId: 'brush-persist',
      tiles: [{ tileKey: '0:2:3', tile: source }],
    })
    const sent = vi.mocked(platform.persistBrushTiles).mock.calls[0]?.[0].tiles[0]?.tile
    const loaded = await readImageEditorV3BrushTiles({
      requestId: 'brush-read',
      tiles: [{
        tileKey: '0:2:3',
        resource: { resourceId: PREVIEW_REF, byteSize: 128 },
      }],
    })

    expect(sent?.data).toBeInstanceOf(ArrayBuffer)
    expect(sent?.data).not.toBe(source.data.buffer)
    expect(persisted.tiles).toEqual([{ tileKey: '0:2:3', resourceId: PREVIEW_REF, byteSize: 128 }])
    expect(loaded.tiles[0]?.tile.data).toBeInstanceOf(Float32Array)
    expect([...loaded.tiles[0]!.tile.data]).toEqual([0.25, 1])
  })
})
