import { create, type Font } from 'fontkit'
import type { FontFaceInfo } from '../../../../src/core/fonts/catalog'

type NameRecords = Record<string, Record<string, string>>
type FontTables = { name?: { records?: NameRecords }; post?: { isFixedPitch?: number }; namedVariations?: Record<string, Record<string, number>> }
export interface ParsedFontFace { face: Omit<FontFaceInfo, 'id' | 'imported'>; index: number }

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
    const base = fontMetadata(font)
    const result: ParsedFontFace[] = [{ face: base, index }]
    for (const [style, variation] of Object.entries((font as Font & FontTables).namedVariations ?? {})) {
      if (style === base.style) continue
      result.push({ index, face: { ...base, style, fullName: `${base.family} ${style}`, postscriptName: base.postscriptName, weight: variation.wght ?? base.weight, italic: variation.ital === 1 || Boolean(variation.slnt) || base.italic, variation, aliases: base.aliases.filter(alias => alias !== base.fullName) } })
    }
    return result
  })
}

/** TTC faces need standalone sfnt data for FontFace. Preserve every table and glyph, no subsetting. */
export function standaloneFont(bytes: Buffer, index: number): Buffer {
  if (bytes.toString('ascii', 0, 4) !== 'ttcf') {
    const signature = bytes.toString('ascii', 0, 4)
    if (signature === 'OTTO' || signature === 'wOFF' || signature === 'wOF2' || bytes.readUInt32BE(0) === 0x00010000) return bytes
    // fontkit decodes macOS resource-fork directories; use its verified sfnt resource offsets.
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
