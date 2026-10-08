import { webcrypto } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { CUBE_LUT_MAX_BYTES } from '@/core/videoEdit/cubeLut'
import { decodeVideoEditLut, fetchVideoEditColorLut } from './videoEditColorLutSource'
afterEach(() => { vi.unstubAllGlobals() })
const bytes = new TextEncoder().encode('LUT_1D_SIZE 2\n0 0 0\n1 1 1')
it('Worker 只接收本地授权协议，有界读取并校验内容；错误明确暴露', async () => {
  vi.stubGlobal('crypto', webcrypto)
  const decoded = await decodeVideoEditLut(bytes)
  const asset = { id: 'lut', name: 'Look', path: 'henji-media://local/look.cube', contentIdentity: decoded.contentIdentity }
  const fetcher = vi.fn(async () => new Response(bytes)); vi.stubGlobal('fetch', fetcher)
  expect(await fetchVideoEditColorLut(asset)).toMatchObject({ kind: '1d', size: 2 })
  expect(fetcher).toHaveBeenCalledWith(asset.path)
  await expect(fetchVideoEditColorLut({ ...asset, path: 'D:/look.cube' })).rejects.toThrow('边界转换')
  await expect(fetchVideoEditColorLut({ ...asset, contentIdentity: 'a'.repeat(64) })).rejects.toThrow('恢复或重新导入')
  fetcher.mockImplementationOnce(async () => new Response(new Uint8Array(CUBE_LUT_MAX_BYTES + 1)))
  await expect(fetchVideoEditColorLut(asset)).rejects.toMatchObject({ cause: expect.objectContaining({ message: expect.stringContaining('过大') }) })
  fetcher.mockImplementationOnce(async () => new Response(null, { status: 404 }))
  await expect(fetchVideoEditColorLut(asset)).rejects.toThrow('恢复或重新导入')
})
