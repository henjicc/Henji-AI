/** 可变字体的一个变化轴；tag 是四字符 OpenType 轴标签，name 优先取字体自带的中文名。 */
export interface FontVariationAxis { tag: string; name: string; min: number; default: number; max: number }
/** 字体样式元数据；文件身份仅通过导出会话的独立清单传递。 */
export interface FontFaceInfo {
  id: string
  family: string
  localizedFamily: string
  fullName: string
  postscriptName: string
  style: string
  weight: number
  italic: boolean
  imported: boolean
  supportsCjk: boolean
  category: 'serif' | 'sans-serif' | 'monospace' | 'handwriting' | 'unknown'
  aliases: string[]
  /** 这个样式对应的命名实例坐标；只有可变字体声明的命名实例才有，不合成样式。 */
  variation?: Record<string, number>
  /** 可变字体的全部变化轴；同一字体文件展开出的每个样式都带同一份。非可变字体没有。 */
  axes?: FontVariationAxis[]
}
/** 常见注册轴的中文名；自定义轴用字体自带的名称。 */
const REGISTERED_AXIS_NAMES: Record<string, string> = { wght: '字重', wdth: '字宽', slnt: '倾斜', ital: '斜体', opsz: '光学尺寸' }
export function fontAxisLabel(axis: FontVariationAxis): string { return REGISTERED_AXIS_NAMES[axis.tag] ?? (axis.name || axis.tag) }
/**
 * 文字样式里的轴数值只作用于所选字体真有的轴，并夹在轴范围内；没填的轴取所选样式（命名实例）的坐标。
 * 返回 undefined 表示没有可应用的覆盖（非可变字体或没有命中的轴）。
 */
export function resolveFontVariations(face: Pick<FontFaceInfo, 'axes' | 'variation'> | undefined, overrides: Readonly<Record<string, number>> | undefined): Record<string, number> | undefined {
  if (!face?.axes?.length || !overrides) return undefined
  const applied = face.axes.filter(axis => typeof overrides[axis.tag] === 'number').map(axis => [axis.tag, Math.min(axis.max, Math.max(axis.min, overrides[axis.tag]))] as const)
  return applied.length ? { ...face.variation, ...Object.fromEntries(applied) } : undefined
}
export interface FontCatalog { faces: FontFaceInfo[]; revision: number }
/** 导出固定目录的文件身份；只在会话内传递，不写入作品。 */
export interface FontFileSource { face: FontFaceInfo; path: string; index: number; signature: string }
export interface FixedFontCatalog extends FontCatalog { sources: Record<string, FontFileSource> }
/**
 * Font name tables are untrusted: fontkit returns null for absent records (postscriptName is often missing).
 * Every name crosses this boundary as a trimmed string; a face with no usable name is dropped, never half-kept.
 */
export function normalizeFontFace<T extends Omit<FontFaceInfo, 'id' | 'imported'>>(face: T): T | null {
  const text = (value: unknown): string => typeof value === 'string' ? value.trim() : ''
  const family = text(face.family) || text(face.fullName) || text(face.postscriptName)
  if (!family) return null
  const fullName = text(face.fullName) || family
  return { ...face, family, localizedFamily: text(face.localizedFamily) || family, fullName, postscriptName: text(face.postscriptName), style: text(face.style) || 'Regular',
    aliases: [...new Set((Array.isArray(face.aliases) ? face.aliases : []).map(text).filter(Boolean))] }
}
export interface FontPreferences { favorites: string[]; recent: string[] }
export type FontFilter = 'all' | 'cjk' | 'latin' | 'serif' | 'sans-serif' | 'monospace' | 'handwriting' | 'imported' | 'favorites' | 'recent' | 'project'
export const GENERIC_FONT_FACES: FontFaceInfo[] = (['sans-serif', 'serif', 'monospace'] as const).map(family => ({
  id: `generic:${family}`, family, localizedFamily: { 'sans-serif': '系统无衬线', serif: '系统衬线', monospace: '系统等宽' }[family],
  fullName: family, postscriptName: '', style: 'Regular', weight: 400, italic: false, imported: false, supportsCjk: true, category: family, aliases: [family],
}))
export function fontMatchesName(face: FontFaceInfo, name: string): boolean {
  const key = name.trim().toLocaleLowerCase()
  return [face.family, face.localizedFamily, face.fullName, face.postscriptName, ...face.aliases].some(alias => alias.toLocaleLowerCase() === key)
}
/** A family is one CSS token, never a CSS expression or an injected fallback list. */
export function cssFontFamily(name: string): string {
  if (['sans-serif', 'serif', 'monospace'].includes(name)) return name
  // eslint-disable-next-line no-control-regex -- CSS quoted family names must escape control characters.
  return `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\u0000-\u001f\u007f]/g, char => `\\${char.charCodeAt(0).toString(16)} `)}", sans-serif`
}
export function filterFonts(faces: FontFaceInfo[], query: string, filter: FontFilter, preferences: FontPreferences, project: readonly string[] = []): FontFaceInfo[] {
  const text = query.trim().toLocaleLowerCase()
  return faces.filter(face => (!text || [face.family, face.localizedFamily, face.fullName, face.postscriptName, ...face.aliases].some(name => name.toLocaleLowerCase().includes(text))) && (
    filter === 'all' || filter === 'cjk' && face.supportsCjk || filter === 'latin' && !face.supportsCjk ||
    filter === face.category || filter === 'imported' && face.imported ||
    filter === 'favorites' && preferences.favorites.some(name => fontMatchesName(face, name)) ||
    filter === 'recent' && preferences.recent.some(name => fontMatchesName(face, name)) ||
    filter === 'project' && project.some(name => fontMatchesName(face, name))
  ))
}
