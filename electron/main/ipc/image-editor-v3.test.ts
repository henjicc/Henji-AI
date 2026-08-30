import { describe, expect, it, vi } from 'vitest'

import { ImageEditCommandHistoryV3 } from '../../../src/core/imageEdit/v3/commandHistory'
import {
  createImageEditDocumentV3,
  createImageEditRasterLayerV3,
} from '../../../src/core/imageEdit/v3/documentFactory'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/henji-test') },
  BrowserWindow: { fromWebContents: vi.fn() },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  ipcMain: { handle: vi.fn() },
}))

vi.mock('../window', () => ({ getMainWindow: vi.fn() }))

import {
  parseImageEditorV3LoadPayload,
  parseImageEditorV3FastProxyPayload,
  parseImageEditorV3IngestSourcePayload,
  parseImageEditorV3PyramidPrewarmPayload,
  parseImageEditorV3SavePayload,
  parseImageEditorV3TilePayload,
} from './image-editor-v3'

const RESOURCE_A = `sha256:${'a'.repeat(64)}`
const RESOURCE_B = `sha256:${'b'.repeat(64)}`

function document(revision: number): Record<string, unknown> {
  return {
    ...createImageEditDocumentV3({
      width: 100,
      height: 80,
      documentId: 'document-contract',
    }),
    revision,
  }
}

describe('图片编辑 V3 IPC 边界', () => {
  it('接受 revision 0 初始文档并去重、排序内容寻址引用', () => {
    expect(parseImageEditorV3SavePayload({
      requestId: 'image-editor-v3:save:initial',
      document: document(0),
      expectedRevision: 0,
      resourceRefs: [RESOURCE_B, RESOURCE_A, RESOURCE_B],
      previewRef: RESOURCE_A,
    })).toMatchObject({
      documentId: 'document-contract',
      revision: 0,
      expectedRevision: 0,
      resourceRefs: [RESOURCE_A, RESOURCE_B],
      previewRef: RESOURCE_A,
    })
  })

  it('拒绝倒退的 CAS、路径冒充文档引用和非法资源哈希', () => {
    expect(() => parseImageEditorV3SavePayload({
      requestId: 'image-editor-v3:save:stale',
      document: document(2),
      expectedRevision: 3,
      resourceRefs: [],
    })).toThrow('predates expectedRevision')
    expect(() => parseImageEditorV3LoadPayload({
      requestId: 'image-editor-v3:load:path',
      documentRef: '/Users/test/source.henjiimg',
    })).toThrow('Invalid image edit document reference')
    expect(() => parseImageEditorV3SavePayload({
      requestId: 'image-editor-v3:save:hash',
      document: document(1),
      expectedRevision: 0,
      resourceRefs: ['sha256:not-a-hash'],
    })).toThrow('Invalid resourceRefs')
  })

  it('严格校验历史头与字段，并要求 resourceRefs 保留撤销所需资源', () => {
    const initial = {
      ...createImageEditDocumentV3({ width: 32, height: 32, documentId: 'history-ipc' }),
      layers: [createImageEditRasterLayerV3('paint', '画笔')],
    }
    const history = new ImageEditCommandHistoryV3()
    history.clear(initial)
    const painted = history.execute(initial, {
      type: 'raster.apply-tile-delta',
      commandId: 'ipc-paint',
      expectedRevision: 0,
      layerId: 'paint',
      changes: [{
        tileKey: '0:0:0',
        previousResourceId: null,
        previousByteSize: 0,
        resourceId: RESOURCE_A,
        byteSize: 4,
      }],
    })
    const undone = history.undo(painted).document
    const snapshot = history.createSnapshot()
    const payload = {
      requestId: 'image-editor-v3:save:history',
      document: undone,
      expectedRevision: undone.revision,
      resourceRefs: [RESOURCE_A],
      history: snapshot,
    }
    expect(parseImageEditorV3SavePayload(payload)).toMatchObject({ history: snapshot })
    expect(() => parseImageEditorV3SavePayload({ ...payload, resourceRefs: [] }))
      .toThrow('omit')
    expect(() => parseImageEditorV3SavePayload({
      ...payload,
      history: { ...snapshot, headRevision: snapshot.headRevision + 1 },
    })).toThrow('head')
    expect(() => parseImageEditorV3SavePayload({
      ...payload,
      history: { ...snapshot, unknown: true },
    })).toThrow('未知字段')
    expect(() => parseImageEditorV3SavePayload({
      ...payload,
      history: JSON.stringify(snapshot),
    })).toThrow('structured snapshot')
    expect(() => parseImageEditorV3SavePayload({
      ...payload,
      history: {
        ...snapshot,
        undo: Array.from({ length: 201 }, () => snapshot.redo[0]),
        redo: [],
      },
    })).toThrow('数量超过上限')
  })

  it('透传 16/32 位瓦片请求，并在 IPC 边界限制 halo 与坐标', () => {
    expect(parseImageEditorV3TilePayload({
      requestId: 'image-editor-v3:tile:16bit',
      resourceRef: RESOURCE_A,
      mip: 3,
      tileX: 12,
      tileY: 7,
      halo: 256,
      bitDepth: 16,
    })).toMatchObject({ mip: 3, tileX: 12, tileY: 7, halo: 256, bitDepth: 16 })
    expect(parseImageEditorV3TilePayload({
      requestId: 'image-editor-v3:tile:32bit',
      resourceRef: RESOURCE_A,
      mip: 0,
      tileX: 0,
      tileY: 0,
      bitDepth: 32,
    })).toMatchObject({ halo: 0, bitDepth: 32 })
    expect(() => parseImageEditorV3TilePayload({
      requestId: 'image-editor-v3:tile:oversized',
      resourceRef: RESOURCE_A,
      mip: 0,
      tileX: 0,
      tileY: 0,
      halo: 513,
    })).toThrow('Invalid halo')
    expect(() => parseImageEditorV3FastProxyPayload({
      requestId: 'image-editor-v3:proxy:oversized',
      resourceRef: RESOURCE_A,
      maxDimension: 4_097,
    })).toThrow('Invalid maxDimension')
  })

  it('限制源金字塔预热范围、精度和瓦片预算', () => {
    expect(parseImageEditorV3PyramidPrewarmPayload({
      requestId: 'pyramid-prewarm',
      resourceRef: RESOURCE_A,
      minimumMip: 4,
      maximumMip: 8,
      tileBudget: 64,
      bitDepth: 16,
    })).toMatchObject({ minimumMip: 4, maximumMip: 8, tileBudget: 64, bitDepth: 16 })
    expect(() => parseImageEditorV3PyramidPrewarmPayload({
      requestId: 'pyramid-prewarm', resourceRef: RESOURCE_A,
      minimumMip: 9, maximumMip: 8, tileBudget: 64,
    })).toThrow('mip range')
    expect(() => parseImageEditorV3PyramidPrewarmPayload({
      requestId: 'pyramid-prewarm', resourceRef: RESOURCE_A,
      tileBudget: 4_097,
    })).toThrow('tileBudget')
  })

  it('只接受受限的本地、HTTP(S) 与 Data URL 来源描述', () => {
    expect(parseImageEditorV3IngestSourcePayload({
      requestId: 'image-editor-v3:ingest:local',
      source: { kind: 'local-path', filePath: '/tmp/source.png' },
    })).toEqual({
      requestId: 'image-editor-v3:ingest:local',
      source: { kind: 'local-path', filePath: '/tmp/source.png' },
    })
    expect(parseImageEditorV3IngestSourcePayload({
      requestId: 'image-editor-v3:ingest:url',
      source: { kind: 'http-url', url: 'https://example.test/image.png' },
    })).toMatchObject({ source: { kind: 'http-url', url: 'https://example.test/image.png' } })
    expect(() => parseImageEditorV3IngestSourcePayload({
      requestId: 'image-editor-v3:ingest:relative',
      source: { kind: 'local-path', filePath: '../private.png' },
    })).toThrow('Invalid local image source path')
    expect(() => parseImageEditorV3IngestSourcePayload({
      requestId: 'image-editor-v3:ingest:credentials',
      source: { kind: 'http-url', url: 'https://user:pass@example.test/image.png' },
    })).toThrow('Invalid HTTP image source URL')
  })
})
