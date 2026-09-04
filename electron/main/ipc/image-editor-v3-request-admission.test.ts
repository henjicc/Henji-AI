import { describe, expect, it } from 'vitest'

import {
  estimateImageEditorV3BrushPersistBytes,
  estimateImageEditorV3BrushReadBytes,
  estimateImageEditorV3PyramidPrewarmBytes,
  estimateImageEditorV3TileRequestBytes,
  ImageEditorV3RequestAdmission,
  IMAGE_EDITOR_V3_REQUEST_BUDGET_BYTES,
} from './image-editor-v3-request-admission'

describe('图片编辑 V3 请求准入', () => {
  it('限制同一渲染器的瓦片并发并在释放后恢复额度', () => {
    const admission = new ImageEditorV3RequestAdmission()
    const first = admission.admit('source.tile', 'first', 7, 32)
    const second = admission.admit('source.tile', 'second', 7, 48)
    expect(admission.getSnapshot()).toEqual({ activeRequests: 2, admittedBytes: 80 })
    expect(() => admission.admit('source.tile', 'third', 7, 1)).toThrow('concurrency limit')
    first.release()
    const third = admission.admit('source.tile', 'third', 7, 1)
    second.release()
    third.release()
    expect(admission.getSnapshot()).toEqual({ activeRequests: 0, admittedBytes: 0 })
  })

  it('拒绝超过统一硬预算的请求，并按 sender 精确取消', () => {
    const admission = new ImageEditorV3RequestAdmission()
    const ticket = admission.admit('document.load', 'load', 2, IMAGE_EDITOR_V3_REQUEST_BUDGET_BYTES)
    expect(() => admission.admit('document.load', 'other', 3, 1)).toThrow('memory budget')
    expect(admission.cancel(3, 'load')).toBe(false)
    expect(admission.cancel(2, 'load')).toBe(true)
    expect(ticket.signal.aborted).toBe(true)
    ticket.release()
  })

  it('容纳多图层编辑器的合法组合并发，同时保留每发送方硬上限', () => {
    const admission = new ImageEditorV3RequestAdmission()
    const tickets = [
      admission.admit('document.load', 'load', 5, 1),
      admission.admit('source.pyramid_prewarm', 'prewarm', 5, 1),
      admission.admit('raster_export.start', 'preview', 5, 1),
      admission.admit('source.tile_batch', 'coarse', 5, 1),
      admission.admit('source.tile_batch', 'target', 5, 1),
      admission.admit('source.fast_proxy', 'proxy', 5, 1),
    ]

    expect(admission.getSnapshot()).toEqual({ activeRequests: 6, admittedBytes: 6 })
    expect(() => admission.admit('document.load', 'seventh', 5, 1))
      .toThrow('concurrency limit')
    tickets.forEach((ticket) => ticket.release())
    expect(admission.getSnapshot()).toEqual({ activeRequests: 0, admittedBytes: 0 })
  })

  it('按 halo、位深和三份在途缓冲估算瓦片峰值', () => {
    expect(estimateImageEditorV3TileRequestBytes({ halo: 512, bitDepth: 32 }))
      .toBe(1_536 * 1_536 * 4 * 4 * 3)
  })

  it('金字塔预热按单瓦片串行工作集准入，而不是按整层像素估算', () => {
    expect(estimateImageEditorV3PyramidPrewarmBytes(32))
      .toBe(512 * 512 * 4 * 4 * 3 + 16 * 1024 * 1024)
  })

  it('画笔批次按输入、解压结果与 IPC 副本计入统一资源账本', () => {
    expect(estimateImageEditorV3BrushPersistBytes(4 * 1024 * 1024))
      .toBe(20 * 1024 * 1024)
    expect(estimateImageEditorV3BrushReadBytes(2 * 1024 * 1024, 8 * 1024 * 1024))
      .toBe(28 * 1024 * 1024)
  })

  it('同一渲染器只允许一个画笔持久化批次并支持按 requestId 取消', () => {
    const admission = new ImageEditorV3RequestAdmission()
    const active = admission.admit('brush_tiles.persist', 'brush-first', 9, 1024)

    expect(() => admission.admit('brush_tiles.persist', 'brush-second', 9, 1024))
      .toThrow('concurrency limit')
    expect(admission.cancel(9, 'brush-first')).toBe(true)
    expect(active.signal.aborted).toBe(true)
    active.release()
  })
})
