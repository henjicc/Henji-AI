import { CUBE_LUT_MAX_BYTES, parseCubeLut, type CubeLut } from '@/core/videoEdit/cubeLut'
import type { LumetriLutAsset } from '@/core/videoEdit/lumetriLutAsset'

/** Worker-safe: no PAL/window imports. The render-session boundary supplies an authorized URL. */
export async function decodeVideoEditLut(bytes: Uint8Array): Promise<{ lut: CubeLut; contentIdentity: string }> {
  if (bytes.byteLength > CUBE_LUT_MAX_BYTES) throw new Error('LUT 文件过大，最多24MiB。')
  const contentIdentity = [...new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)))].map(value => value.toString(16).padStart(2, '0')).join('')
  return { lut: parseCubeLut(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), contentIdentity }
}

export async function fetchVideoEditLumetriLut(asset: LumetriLutAsset): Promise<CubeLut> {
  if (!/^henji-media:\/\//i.test(asset.path)) throw new Error('LUT Worker 需要授权的 henji-media 地址，请在 VideoEditRenderSession 边界转换本地路径。')
  try {
    const response = await fetch(asset.path)
    if (!response.ok || !response.body) throw new Error('LUT 文件读取失败。')
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0
    try {
      let result = await reader.read()
      while (!result.done) {
        size += result.value.byteLength
        if (size > CUBE_LUT_MAX_BYTES) throw new Error('LUT 文件过大，最多24MiB。')
        chunks.push(result.value)
        result = await reader.read()
      }
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
    const bytes = new Uint8Array(size); let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    const result = await decodeVideoEditLut(bytes)
    if (result.contentIdentity !== asset.contentIdentity) throw new Error('LUT 文件内容已改变。')
    return result.lut
  } catch (error) { throw new Error(`无法使用“${asset.name}”，请恢复或重新导入 LUT。`, { cause: error }) }
}
