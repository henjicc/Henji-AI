import { describe, expect, it } from 'vitest'

import {
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

  it('按 halo、位深和三份在途缓冲估算瓦片峰值', () => {
    expect(estimateImageEditorV3TileRequestBytes({ halo: 512, bitDepth: 32 }))
      .toBe(1_536 * 1_536 * 4 * 4 * 3)
  })
})
