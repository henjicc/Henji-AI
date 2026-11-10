import { create, type Font } from 'fontkit'
import { convert } from 'fontverter'
import { normalizeFontFace, type FontFaceInfo, type FontVariationAxis } from '../../../../src/core/fonts/catalog'

type NameRecords = Record<string, Record<string, string>>
type LocalizedName = Record<string, string> | undefined
interface FvarTable { axis: Array<{ axisTag: string; minValue: number; defaultValue: number; maxValue: number; name?: LocalizedName }>; instance: Array<{ name?: LocalizedName; nameID: number; coord: number[] }> }
type FontTables = { name?: { records?: NameRecords }; post?: { isFixedPitch?: number }; fvar?: FvarTable }
export interface ParsedFontFace { face: Omit<FontFaceInfo, 'id' | 'imported'>; index: number }
/** 解析结果的结构版本；缓存里旧版本的解析结果（缺少变化轴）在下次扫描时重新解析。 */
export const FONT_METADATA_VERSION = 2

const localized = (value: LocalizedName): string => {
  const entries = Object.entries(value ?? {}).filter(([, text]) => typeof text === 'string' && text.trim())
  return (entries.find(([language]) => /^zh(?:-|$)/i.test(language)) ?? entries.find(([language]) => /^en(?:-|$)/i.test(language)) ?? entries[0])?.[1].trim() ?? ''
}
/** 直接读 fvar：fontkit 的 namedVariations 在实例名引用 nameID 2/17 时会因取不到英文名而抛错，整个字体就导入不了。 */
function variableAxes(font: Font): { axes: FontVariationAxis[]; instances: Array<{ style: string; variation: Record<string, number> }> } | undefined {
  const fvar = (font as Font & FontTables).fvar
  if (!fvar?.axis?.length) return undefined
  const axes = fvar.axis.map(axis => ({ tag: axis.axisTag, name: localized(axis.name) || axis.axisTag, min: axis.minValue, default: axis.defaultValue, max: axis.maxValue }))
  const fallback = (id: number): string => id === 2 ? font.subfamilyName : id === 17 ? localized((font as Font & FontTables).name?.records?.preferredSubfamily) || font.subfamilyName : ''
  const instances = (fvar.instance ?? []).flatMap(instance => {
    const style = localized(instance.name) || fallback(instance.nameID)
    return style ? [{ style, variation: Object.fromEntries(axes.map((axis, index) => [axis.tag, instance.coord[index] ?? axis.default])) }] : []
  })
  return { axes, instances }
}

export function fontMetadata(font: Font): Omit<FontFaceInfo, 'id' | 'imported'> {
  const tables = font as Font & FontTables
  const names = tables.name?.records ?? {}
  const families = names.preferredFamily ?? names.fontFamily ?? {}
  const aliases = [...new Set([...Object.values(families), ...Object.values(names.fontFamily ?? {}), ...Object.values(names.fullName ?? {})])].filter(value => typeof value === 'string' && Boolean(value.trim()))
  const localizedFamily = [...Object.entries(families), ...Object.entries(names.fontFamily ?? {})].find(([language]) => /^zh(?:-|$)/i.test(language))?.[1] ?? font.familyName
  const os2 = font['OS/2']
  const familyClass = ((os2?.sFamilyClass ?? 0) >>> 8) & 255
  const panose = os2?.panose ?? []
  const category: FontFaceInfo['category'] = tables.post?.isFixedPitch || panose[3] === 9 ? 'monospace'
    : familyClass === 10 || panose[0] === 3 ? 'handwriting'
      : familyClass === 8 || panose[0] === 2 && panose[1] >= 11 && panose[1] <= 15 ? 'sans-serif'
        : familyClass >= 1 && familyClass <= 7 || panose[0] === 2 && panose[1] >= 2 && panose[1] <= 10 ? 'serif' : 'unknown'
  return {
    family: font.familyName, localizedFamily, fullName: font.fullName || font.postscriptName || font.familyName,
    postscriptName: font.postscriptName, style: font.subfamilyName || 'Regular', weight: os2?.usWeightClass || 400,
    italic: font.italicAngle !== 0, category, aliases,
    // Inspect the entire cmap: subset fonts may omit common probe characters.
    supportsCjk: font.characterSet.some(point => point >= 0x3400 && point <= 0x9fff || point >= 0xf900 && point <= 0xfaff || point >= 0x20000 && point <= 0x323af || point >= 0x3040 && point <= 0x30ff || point >= 0xac00 && point <= 0xd7af),
  }
}
export function parseFontFile(bytes: Buffer): ParsedFontFace[] {
  const value = create(bytes)
  const fonts = 'fonts' in value ? value.fonts : [value]
  return fonts.flatMap((font, index) => {
    const variable = variableAxes(font)
    const base = { ...fontMetadata(font), ...(variable ? { axes: variable.axes } : {}) }
    const result: ParsedFontFace[] = [{ face: base, index }]
    for (const { style, variation } of variable?.instances ?? []) {
      if (style === base.style || result.some(entry => entry.face.style === style)) continue
      result.push({ index, face: { ...base, style, fullName: `${base.family} ${style}`, postscriptName: base.postscriptName, weight: variation.wght ?? base.weight, italic: variation.ital === 1 || Boolean(variation.slnt) || base.italic, variation, aliases: base.aliases.filter(alias => alias !== base.fullName) } })
    }
    return result.flatMap(entry => { const face = normalizeFontFace(entry.face); return face ? [{ ...entry, face }] : [] })
  })
}

/** HarfBuzz 与 FontFace 共用完整 SFNT；压缩字体在字体 CPU worker 解码，不能用 subset 丢表。 */
export async function standaloneFont(bytes: Buffer, index: number): Promise<Buffer> {
  const signature = bytes.toString('ascii', 0, 4)
  if (signature === 'wOFF' || signature === 'wOF2') return convert(bytes, 'sfnt')
  if (bytes.toString('ascii', 0, 4) !== 'ttcf') {
    if (signature === 'OTTO' || signature === 'true' || bytes.readUInt32BE(0) === 0x00010000) return bytes
    // dfont 的资源偏移由 fontkit 解析，提取时保留所有字体表。
    const collection = create(bytes) as unknown as { type: string; header?: { dataOffset: number }; sfnt?: { refList: Array<{ dataOffset: number }> } }
    if (collection.type !== 'DFont' || !collection.header || !collection.sfnt) throw new Error('字体格式不能用于画面渲染。')
    const ref = collection.sfnt.refList[index]
    if (!ref) throw new Error('字体集合中的样式不存在。')
    const start = collection.header.dataOffset + ref.dataOffset
    const length = bytes.readUInt32BE(start)
    if (start + 4 + length > bytes.length) throw new Error('字体文件损坏。')
    return bytes.subarray(start + 4, start + 4 + length)
  }
  const count = bytes.readUInt32BE(8)
  if (!Number.isInteger(index) || index < 0 || index >= count) throw new Error('字体集合中的样式不存在。')
  const offset = bytes.readUInt32BE(12 + index * 4)
  const tables = bytes.readUInt16BE(offset + 4)
  const headerSize = 12 + 16 * tables
  if (offset + headerSize > bytes.length) throw new Error('字体文件损坏。')
  const records = Array.from({ length: tables }, (_, n) => {
    const at = offset + 12 + n * 16
    const start = bytes.readUInt32BE(at + 8); const size = bytes.readUInt32BE(at + 12)
    if (start + size > bytes.length) throw new Error('字体文件损坏。')
    return { at, start, size }
  })
  const output = Buffer.alloc(headerSize + records.reduce((sum, record) => sum + Math.ceil(record.size / 4) * 4, 0))
  bytes.copy(output, 0, offset, offset + headerSize)
  let cursor = headerSize; let head = -1
  records.forEach((record, n) => {
    bytes.copy(output, cursor, record.start, record.start + record.size)
    output.writeUInt32BE(cursor, 12 + n * 16 + 8)
    if (bytes.toString('ascii', record.at, record.at + 4) === 'head') { head = cursor; output.writeUInt32BE(0, head + 8) }
    cursor += Math.ceil(record.size / 4) * 4
  })
  if (head >= 0) {
    let checksum = 0
    for (let at = 0; at < output.length; at += 4) checksum = (checksum + output.readUInt32BE(at)) >>> 0
    output.writeUInt32BE((0xb1b0afba - checksum) >>> 0, head + 8)
  }
  return output
}
