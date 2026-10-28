import type { VideoEditDocument } from '../document'
import type { CodeSceneMediaKind } from './sceneDeclaration'
import type { VideoEditSceneRecord } from './sceneSchema'

const mediaKinds = new WeakMap<VideoEditDocument['media'], ReadonlyMap<string, CodeSceneMediaKind>>()
/**
 * 剪辑素材 ID → 种类：解析片子数据（resolveVideoEditScene 的 media，窗口内容引用图片素材时按截图处理）与校验
 * media 字段都用它。按素材数组的对象身份复用同一个表：解析器缓存认这个表的身份，剪辑文档与由它组成的渲染快照
 * 共用同一个素材数组，所以拿到同一个表，同一文档版本里的解析结果不重算。
 */
export function videoEditSceneMedia(document: Pick<VideoEditDocument, 'media'>): ReadonlyMap<string, CodeSceneMediaKind> {
  let kinds = mediaKinds.get(document.media)
  if (!kinds) { kinds = new Map(document.media.map(media => [media.id, media.kind])); mediaKinds.set(document.media, kinds) }
  return kinds
}

const recordStrings = new WeakMap<VideoEditSceneRecord, readonly string[]>()
/** 记录取值里的全部字符串（含嵌套对象与列表），按记录对象身份缓存：文档快照不可变，没改的记录跨编辑复用。 */
function stringsOf(record: VideoEditSceneRecord): readonly string[] {
  let strings = recordStrings.get(record)
  if (strings) return strings
  const found: string[] = [], stack: unknown[] = [record.values]
  while (stack.length) {
    const value = stack.pop()
    if (typeof value === 'string') found.push(value)
    else if (Array.isArray(value)) stack.push(...value)
    else if (value && typeof value === 'object') stack.push(...Object.values(value))
  }
  strings = found; recordStrings.set(record, strings)
  return strings
}
/**
 * 这些记录引用到的剪辑素材 ID（按首次出现排序、去重）。片段上只存 {kind:'scene', sceneId}，录屏、截图素材只出现在
 * 片子数据的记录里：预渲染指纹与跟踪签名靠它计入这些素材的身份，素材重新定位或换了源文件时用到它的画面才会失效。
 * 不看声明，取值里等于某个素材 ID 的字符串都算（宁可多算，不漏）。
 */
export function videoEditSceneRecordMediaIds(document: Pick<VideoEditDocument, 'media'>, records: Iterable<VideoEditSceneRecord>): string[] {
  const kinds = videoEditSceneMedia(document), ids = new Set<string>()
  for (const record of records) for (const text of stringsOf(record)) if (kinds.has(text)) ids.add(text)
  return [...ids]
}
