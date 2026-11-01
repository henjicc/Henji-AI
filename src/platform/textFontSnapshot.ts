import type { FontReader } from '@/core/imaging/vectorContent/shaping/fontSession'
import type { FontSnapshot } from '@/core/imaging/vectorContent/shaping/fontChannel'
import type { FixedFontCatalog } from '@/core/fonts/catalog'
import { loadFontLibrary, readFixedFontPayload } from './fonts'
import { getPlatform } from './runtime'

/** 快照只持有目录；字节直接交给 Worker，导出按固定文件身份读取，共用会话字节缓存。 */
export async function captureTextFontSnapshot(platform: 'win32' | 'darwin', fixed?: Promise<FixedFontCatalog>): Promise<FontSnapshot> {
  const catalog = await (fixed ?? loadFontLibrary())
  let closed = false
  const read: FontReader = async request => {
    if (closed) throw new Error('字体快照已经释放')
    const face = catalog.faces.find(face => face.id === request.id)
    if (!face) return undefined
    const payload = await ('sources' in catalog ? readFixedFontPayload(catalog, face) : getPlatform().fonts.readFace(face.id))
    if (closed) throw new Error('字体快照已经释放，丢弃迟到字节')
    return { bytes: Uint8Array.from(payload.bytes).buffer, variations: payload.face.variation }
  }
  return { revision: catalog.revision, platform, faces: catalog.faces, read, close: () => { closed = true } }
}
