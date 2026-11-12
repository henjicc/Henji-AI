import { parseCubeLut, CUBE_LUT_MAX_BYTES, type CubeLut } from '@/core/imaging/lut/cube'
import { toFetchableMediaUrl } from '@/services/imageSource'
import { scaleImageEditCacheBytes } from '@/core/imageEdit/v3/resourceBudget'

// Immutable resources are cached by content, in the render worker that consumes them.
const cache = new Map<string, Promise<CubeLut>>()
const sizes = new Map<string, number>()
// 每个渲染 Worker 的已解析查找表缓存目标，按机器内存放大；只淘汰，不限制查找表数量。
const CACHE_BYTES = scaleImageEditCacheBytes(64 * 1024 * 1024)
function retain(ref: string, lut: CubeLut): CubeLut {
  sizes.set(ref, lut.data.byteLength)
  let bytes = [...sizes.values()].reduce((sum, size) => sum + size, 0)
  for (const [key, size] of sizes) {
    if (bytes <= CACHE_BYTES) break
    sizes.delete(key); cache.delete(key); bytes -= size
  }
  return lut
}
export async function loadImageColorLutV3(ref: string): Promise<CubeLut> {
  if (!/^sha256:[a-f0-9]{64}$/.test(ref)) throw new Error('颜色查找表需要已导入的资源引用')
  let pending = cache.get(ref)
  if (!pending) {
    pending = (async () => {
      const url = toFetchableMediaUrl(`henji-media://image-editor-v3/${ref.slice(7)}?mediaType=application%2Fx-adobe-cube`)
      const response = await fetch(url)
      if (!response.ok) throw new Error('无法读取颜色查找表，请重新导入')
      const bytes = await response.arrayBuffer()
      if (bytes.byteLength > CUBE_LUT_MAX_BYTES) throw new Error('颜色查找表超过解析工作集')
      return retain(ref, parseCubeLut(new TextDecoder().decode(bytes)))
    })()
    cache.set(ref, pending)
    pending.catch(() => { if (cache.get(ref) === pending) cache.delete(ref) })
  }
  if (sizes.has(ref)) { const size = sizes.get(ref)!; sizes.delete(ref); sizes.set(ref, size) }
  return pending
}
