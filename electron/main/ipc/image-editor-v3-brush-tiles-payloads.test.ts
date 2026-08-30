import { describe, expect, it } from 'vitest'

import {
  parseImageEditorV3PersistBrushTilesPayload,
  parseImageEditorV3ReadBrushTilesPayload,
} from './image-editor-v3-payloads'

const RESOURCE_REF = `sha256:${'a'.repeat(64)}`

function rgbaTile(data: ArrayBuffer | Float32Array = new Float32Array([0.25, 0.1, 0, 0.5])) {
  return {
    storage: 'rgba-float32',
    width: 1,
    height: 1,
    data,
    colorDomain: 'linear-light',
    workingSpace: 'display-p3',
    transferFunction: 'linear',
    referenceWhiteNits: 203,
    alpha: 'premultiplied',
  }
}

describe('图片编辑 V3 画笔瓦片 IPC payload', () => {
  it('批量接收 RGBA ArrayBuffer 与蒙版 Float32Array，并保留紧密独占视图', () => {
    const rgba = new Float32Array([0.25, 0.1, 0, 0.5])
    const mask = new Float32Array([0, 0.25, 0.5, 1])
    const parsed = parseImageEditorV3PersistBrushTilesPayload({
      requestId: 'brush-persist',
      tiles: [
        { tileKey: '0:0:0', tile: rgbaTile(rgba.buffer) },
        {
          tileKey: '0:1:0',
          tile: { storage: 'mask-float32', width: 2, height: 2, data: mask },
        },
      ],
    })

    expect(parsed.rawByteLength).toBe(32)
    expect(parsed.tiles.map((item) => item.tileKey)).toEqual(['0:0:0', '0:1:0'])
    expect(parsed.tiles[0]?.tile.data).toBeInstanceOf(Float32Array)
    expect(parsed.tiles[0]?.tile.data.byteOffset).toBe(0)
    expect(parsed.tiles[0]?.tile.data.byteLength).toBe(parsed.tiles[0]?.tile.data.buffer.byteLength)
    expect([...parsed.tiles[1]!.tile.data]).toEqual([0, 0.25, 0.5, 1])
  })

  it('拒绝带隐藏 backing bytes、长度错误或错误颜色契约的数据', () => {
    const oversizedBacking = new Float32Array(8)
    const offsetView = new Float32Array(oversizedBacking.buffer, 4, 4)
    expect(() => parseImageEditorV3PersistBrushTilesPayload({
      requestId: 'brush-offset',
      tiles: [{ tileKey: '0:0:0', tile: rgbaTile(offsetView) }],
    })).toThrow('exact, unshared backing buffer')
    expect(() => parseImageEditorV3PersistBrushTilesPayload({
      requestId: 'brush-shared',
      tiles: [{
        tileKey: '0:0:0',
        tile: rgbaTile(new Float32Array(new SharedArrayBuffer(16))),
      }],
    })).toThrow('exact, unshared backing buffer')
    expect(() => parseImageEditorV3PersistBrushTilesPayload({
      requestId: 'brush-length',
      tiles: [{
        tileKey: '0:0:0',
        tile: { storage: 'mask-float32', width: 2, height: 1, data: new ArrayBuffer(4) },
      }],
    })).toThrow('length mismatch')
    expect(() => parseImageEditorV3PersistBrushTilesPayload({
      requestId: 'brush-alpha',
      tiles: [{ tileKey: '0:0:0', tile: { ...rgbaTile(), alpha: 'straight' } }],
    })).toThrow('premultiplied alpha')
    expect(() => parseImageEditorV3PersistBrushTilesPayload({
      requestId: 'brush-color',
      tiles: [{ tileKey: '0:0:0', tile: { ...rgbaTile(), workingSpace: 'unknown' } }],
    })).toThrow('workingSpace')
  })

  it('严格限制批次键、未知字段和读取资源预算', () => {
    expect(() => parseImageEditorV3PersistBrushTilesPayload({
      requestId: 'brush-duplicate',
      tiles: [
        { tileKey: '0:0:0', tile: rgbaTile() },
        { tileKey: '0:0:0', tile: rgbaTile() },
      ],
    })).toThrow('duplicate tileKey')
    expect(() => parseImageEditorV3PersistBrushTilesPayload({
      requestId: 'brush-field',
      tiles: [{ tileKey: '0:0:0', tile: rgbaTile(), extra: true }],
    })).toThrow('unknown field')
    expect(() => parseImageEditorV3ReadBrushTilesPayload({
      requestId: 'brush-read-invalid-key',
      tiles: [{ tileKey: '../0', resource: { resourceRef: RESOURCE_REF, byteSize: 80 } }],
    })).toThrow('tileKey')
    expect(() => parseImageEditorV3ReadBrushTilesPayload({
      requestId: 'brush-read-budget',
      tiles: Array.from({ length: 13 }, (_, index) => ({
        tileKey: `0:${index}:0`,
        resource: { resourceRef: RESOURCE_REF, byteSize: 5 * 1024 * 1024 },
      })),
    })).toThrow('resource byte budget')
  })

  it('读取请求保留资源引用顺序并计算最坏解压预算', () => {
    const parsed = parseImageEditorV3ReadBrushTilesPayload({
      requestId: 'brush-read',
      tiles: [{ tileKey: '2:3:4', resource: { resourceRef: RESOURCE_REF, byteSize: 120 } }],
    })

    expect(parsed).toMatchObject({
      requestId: 'brush-read',
      resourceByteLength: 120,
      maximumDecodedByteLength: 512 * 512 * 4 * 4,
      tiles: [{ tileKey: '2:3:4', resource: { resourceId: RESOURCE_REF, byteSize: 120 } }],
    })
  })
})
