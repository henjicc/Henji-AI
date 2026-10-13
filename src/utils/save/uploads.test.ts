// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureCompressedJpegBytesWithPica } from './uploads'

const mocks = vi.hoisted(() => ({ resize: vi.fn(), toBlob: vi.fn(), draw: vi.fn(), failDecode: false }))
vi.mock('pica', () => ({ default: class { resize = mocks.resize; toBlob = mocks.toBlob } }))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.failDecode = false
  mocks.resize.mockResolvedValue(undefined)
  mocks.toBlob.mockResolvedValue({ arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer })
  vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('Unsupported encoding')))
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:decode-source')
    static revokeObjectURL = vi.fn()
  })
  vi.stubGlobal('Image', class {
    onload: (() => void) | null = null
    onerror: ((error: Error) => void) | null = null
    naturalWidth = 100
    naturalHeight = 200
    set src(_url: string) {
      queueMicrotask(() => {
        if (mocks.failDecode) this.onerror?.(new Error('Image decode failed'))
        else this.onload?.()
      })
    }
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ drawImage: mocks.draw }) as unknown as CanvasRenderingContext2D)
})

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('上传图片压缩的解码资源', () => {
  it('图片解码失败仍释放 URL，保留原错误且不尝试缩放', async () => {
    mocks.failDecode = true
    await expect(ensureCompressedJpegBytesWithPica(new Blob(['broken']))).rejects.toThrow('Image decode failed')
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:decode-source')
    expect(mocks.resize).not.toHaveBeenCalled()
  })

  it('正常解码和缩放只释放一次，并返回压缩内容', async () => {
    await expect(ensureCompressedJpegBytesWithPica(new Blob(['image']))).resolves.toEqual(new Uint8Array([1, 2, 3]))
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:decode-source')
    expect(mocks.resize).toHaveBeenCalledTimes(1)
  })

  it('解码后绘制失败也释放 URL', async () => {
    mocks.draw.mockImplementationOnce(() => { throw new Error('Draw failed') })
    await expect(ensureCompressedJpegBytesWithPica(new Blob(['image']))).rejects.toThrow('Draw failed')
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:decode-source')
  })
})
