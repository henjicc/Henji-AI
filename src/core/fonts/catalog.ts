/** Public metadata only: filesystem paths never cross the font boundary. */
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
  /** Only named instances declared by a variable font, never synthetic styles. */
  variation?: Record<string, number>
}
export interface FontCatalog { faces: FontFaceInfo[]; revision: number }
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
