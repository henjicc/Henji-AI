import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

import { ipcMain } from 'electron'
import {
  persistImageEditorV3BrushTileBatch,
  readImageEditorV3BrushTileBatch,
  registerImageEditorV3BrushTileIpc,
} from './image-editor-v3-brush-tiles'
import {
  parseImageEditorV3PersistBrushTilesPayload,
  parseImageEditorV3ReadBrushTilesPayload,
} from './image-editor-v3-payloads'
import {
  ContentAddressedResourceStore,
  ImageEditBrushTileStoreV3,
} from '../services/image-editor-v3'

let rootDir = ''
let store: ImageEditBrushTileStoreV3

beforeEach(async () => {
  vi.mocked(ipcMain.handle).mockClear()
  rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-brush-ipc-'))
  store = new ImageEditBrushTileStoreV3(
    new ContentAddressedResourceStore(path.join(rootDir, 'resources')),
  )
})

afterEach(async () => {
  await fsp.rm(rootDir, { recursive: true, force: true })
})

describe('图片编辑 V3 画笔瓦片 IPC 批处理', () => {
  it('RGBA 与蒙版经内容寻址资源往返后返回精确 ArrayBuffer', async () => {
    const persisted = await persistImageEditorV3BrushTileBatch(
      store,
      parseImageEditorV3PersistBrushTilesPayload({
        requestId: 'brush-roundtrip-persist',
        tiles: [
          {
            tileKey: '0:0:0',
            tile: {
              storage: 'rgba-float32',
              width: 1,
              height: 1,
              data: new Float32Array([0.2, 0.1, 0, 0.5]),
              colorDomain: 'linear-light',
              workingSpace: 'display-p3',
              transferFunction: 'linear',
              referenceWhiteNits: 203,
              alpha: 'premultiplied',
            },
          },
          {
            tileKey: '0:1:0',
            tile: {
              storage: 'mask-float32',
              width: 2,
              height: 1,
              data: new Float32Array([0.25, 1]).buffer,
            },
          },
        ],
      }),
      new AbortController().signal,
    )
    const loaded = await readImageEditorV3BrushTileBatch(
      store,
      parseImageEditorV3ReadBrushTilesPayload({
        requestId: 'brush-roundtrip-read',
        tiles: persisted.tiles,
      }),
      new AbortController().signal,
    )

    expect(persisted.tiles).toHaveLength(2)
    expect(persisted.tiles[0]?.resource.resourceRef).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(loaded.tiles.map((item) => item.tileKey)).toEqual(['0:0:0', '0:1:0'])
    expect(loaded.tiles[0]?.tile.storage).toBe('rgba-float32')
    expect(loaded.tiles[0]?.tile.data).toBeInstanceOf(ArrayBuffer)
    expect([...new Float32Array(loaded.tiles[0]!.tile.data)])
      .toEqual([...new Float32Array([0.2, 0.1, 0, 0.5])])
    expect([...new Float32Array(loaded.tiles[1]!.tile.data)]).toEqual([0.25, 1])
  })

  it('批次开始前取消时不持久化任何瓦片', async () => {
    const payload = parseImageEditorV3PersistBrushTilesPayload({
      requestId: 'brush-cancelled',
      tiles: [{
        tileKey: '0:0:0',
        tile: { storage: 'mask-float32', width: 1, height: 1, data: new Float32Array([1]) },
      }],
    })
    const controller = new AbortController()
    controller.abort()

    await expect(persistImageEditorV3BrushTileBatch(store, payload, controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' })
  })

  it('通过准入后仍由权威 codec 拒绝越界蒙版像素', async () => {
    const payload = parseImageEditorV3PersistBrushTilesPayload({
      requestId: 'brush-invalid-mask',
      tiles: [{
        tileKey: '0:0:0',
        tile: { storage: 'mask-float32', width: 1, height: 1, data: new Float32Array([2]) },
      }],
    })

    await expect(persistImageEditorV3BrushTileBatch(
      store,
      payload,
      new AbortController().signal,
    )).rejects.toThrow('0～1')
  })

  it('注册独立 IPC 通道并把解析后的峰值估算交给统一准入', async () => {
    const admitted: Array<{ operation: string; estimatedBytes: number | undefined }> = []
    async function runRequest<T>(
      operation: string,
      _requestId: string,
      _senderId: number,
      work: (signal: AbortSignal) => Promise<T>,
      estimatedBytes?: number,
    ): Promise<T> {
      admitted.push({ operation, estimatedBytes })
      return work(new AbortController().signal)
    }
    registerImageEditorV3BrushTileIpc({ store, guard: () => undefined, runRequest })
    const registration = vi.mocked(ipcMain.handle).mock.calls.find(
      ([channel]) => channel === 'imageEditorV3:brushTiles:persist',
    )
    if (!registration) throw new Error('Brush persist IPC was not registered')

    const response = await registration[1]({ sender: { id: 17 } } as never, {
      requestId: 'brush-admission',
      tiles: [{
        tileKey: '0:0:0',
        tile: { storage: 'mask-float32', width: 1, height: 1, data: new Float32Array([1]) },
      }],
    })

    expect(response).toMatchObject({ ok: true })
    expect(admitted).toEqual([{
      operation: 'brush_tiles.persist',
      estimatedBytes: 8 * 1024 * 1024 + 12,
    }])
    expect(vi.mocked(ipcMain.handle).mock.calls.map(([channel]) => channel)).toEqual([
      'imageEditorV3:brushTiles:persist',
      'imageEditorV3:brushTiles:read',
    ])
  })
})
