import { orderedValues, type FontSource, type ShapeOptions, TextShaper } from './harfbuzz'
import { fontMatchesName, type FontFaceInfo } from '../../../fonts/catalog'

export interface TextFontRequest { family: string; weight?: number; style?: 'normal' | 'italic' | 'oblique'; variations?: Readonly<Record<string, number>>; id?: string }
export interface TextFontDeclaration {
  faces?: readonly TextFontRequest[]
  text?: readonly string[]
  scripts?: readonly string[]
  bindings?: readonly { text: string; style: string }[]
}
export interface FontCandidate { readonly family: string; readonly font?: FontSource }
export interface FontChain { readonly identity: string; readonly candidates: readonly FontCandidate[]; readonly request?: TextFontRequest }
export type TextFontAccess = Pick<TextFontSession, 'chain' | 'choose'> & { readonly owner?: object; diagnostics?(): readonly string[]; onClose?(cleanup: () => void): void }
export type FontReader = (request: TextFontRequest) => Promise<{ bytes: ArrayBuffer; face?: number; variations?: Readonly<Record<string, number>> } | undefined>
const defaults = {
  win32: ['Arial', 'Microsoft YaHei', 'Yu Gothic', 'Segoe UI Emoji'],
  darwin: ['Helvetica', 'PingFang SC', 'Hiragino Sans', 'Apple Color Emoji'],
} as const
// 候选顺序对齐 Chromium 152 的 font_fallback_win.cc；缺失脸仍进入会话身份。
const windowsScripts: Readonly<Record<string, readonly string[]>> = {
  Hani: ['Noto Sans SC', 'Noto Sans CJK SC', 'Microsoft YaHei', 'SimSun', 'SimSun-ExtB', 'SimSun-ExtG'],
  Hant: ['Noto Sans TC', 'Noto Sans CJK TC', 'Microsoft JhengHei', 'PMingLiU'],
  Kana: ['Noto Sans JP', 'Noto Sans CJK JP', 'Meiryo', 'Yu Gothic', 'MS PGothic', 'Microsoft YaHei'],
  Hang: ['Noto Sans KR', 'Noto Sans CJK KR', 'Malgun Gothic', 'Gulim'],
  Arab: ['Tahoma', 'Segoe UI'], Hebr: ['David', 'Segoe UI'],
  Deva: ['Nirmala UI', 'Mangal'], Beng: ['Nirmala UI', 'Vrinda'], Guru: ['Nirmala UI', 'Raavi'],
  Gujr: ['Nirmala UI', 'Shruti'], Orya: ['Kalinga', 'ori1Uni', 'Lohit Oriya', 'Nirmala UI'],
  Taml: ['Nirmala UI', 'Latha'], Telu: ['Nirmala UI', 'Gautami'], Knda: ['Tunga', 'Nirmala UI'],
  Mlym: ['Nirmala UI', 'Kartika'], Sinh: ['Iskoola Pota', 'AksharUnicode', 'Nirmala UI'],
  Thai: ['Tahoma', 'Leelawadee UI', 'Leelawadee'],
  Laoo: ['Leelawadee UI', 'Lao UI', 'DokChampa', 'Saysettha OT', 'Phetsarath OT', 'Code2000'],
  Khmr: ['Leelawadee UI', 'Khmer UI', 'Khmer OS', 'MoolBoran', 'DaunPenh'],
  Mymr: ['Myanmar Text', 'Padauk', 'Parabaik', 'Myanmar3', 'Code2000'],
  Tibt: ['Microsoft Himalaya', 'Jomolhari', 'Tibetan Machine Uni'],
  Geor: ['Sylfaen', 'Segoe UI'], Armn: ['Segoe UI', 'Sylfaen'],
  Ethi: ['Nyala', 'Abyssinica SIL', 'Ethiopia Jiret', 'Visual Geez Unicode', 'GF Zemen Unicode', 'Ebrima'],
  Cyrl: ['Times New Roman'], Grek: ['Times New Roman'],
  Java: ['Javanese Text'],
}
const windowsPatterns = Object.keys(windowsScripts).filter(script => script !== 'Hant').map(script => [script, new RegExp(`\\p{Script_Extensions=${script}}`, 'u')] as const)
export function defaultTextFonts(platform: keyof typeof defaults, declaration: TextFontDeclaration = {}): readonly TextFontRequest[] {
  const scripts = declaration.scripts ?? [], text = (declaration.text ?? []).join('')
  const all = !declaration.text?.length && !scripts.length
  const eastAsianCommon = /[\u3000-\u303f\uff00-\uffef]/u.test(text)
  const needed = [true,
    all || eastAsianCommon || /[\p{Script_Extensions=Han}\p{Script_Extensions=Hangul}]/u.test(text) || scripts.some(script => ['Hani', 'Han', 'Hans', 'Hant', 'Hang'].includes(script)),
    all || eastAsianCommon || /[\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}]/u.test(text) || scripts.some(script => ['Hira', 'Kana', 'Hrkt', 'Jpan'].includes(script)),
    all || /\p{Extended_Pictographic}|\p{Emoji_Presentation}|\p{Regional_Indicator}|\ufe0f|\u20e3/u.test(text) || scripts.includes('Emoji')]
  if (platform === 'darwin') return defaults[platform].filter((_, index) => needed[index]).map(family => ({ family, weight: 400, style: 'normal' }))
  const aliases: Readonly<Record<string, string>> = { Han: 'Hani', Hans: 'Hani', Hira: 'Kana', Hrkt: 'Kana', Jpan: 'Kana' }
  const selected = new Set(all ? Object.keys(windowsScripts) : scripts.map(script => aliases[script] ?? script))
  for (const [script, pattern] of windowsPatterns) if (pattern.test(text)) selected.add(script)
  if (needed[1]) selected.add('Hani')
  if (needed[2]) selected.add('Kana')
  const families = ['Arial', ...Object.keys(windowsScripts).filter(script => selected.has(script)).flatMap(script => windowsScripts[script]), ...(needed[3] ? ['Segoe UI Emoji'] : []), 'Segoe UI Symbol', 'Segoe UI Historic']
  return [...new Set(families)].map(family => ({ family, weight: 400, style: 'normal' }))
}
export const fontRequestKey = (request: TextFontRequest): string => JSON.stringify([request.family.trim().toLowerCase(), request.weight ?? 400, request.style ?? 'normal', orderedValues(request.variations)])

export function nearestPreparedFont<T>(request: TextFontRequest, choices: readonly { request: TextFontRequest; value: T }[]): T | undefined {
  const weight = request.weight ?? 400
  const rank = (other: TextFontRequest): number => {
    const candidate = other.weight ?? 400
    const distance = weight >= 400 && weight <= 500
      ? candidate >= weight && candidate <= 500 ? candidate - weight : candidate < weight ? 1000 + weight - candidate : 2000 + candidate - weight
      : weight < 400 ? candidate <= weight ? weight - candidate : 1000 + candidate - weight
        : candidate >= weight ? candidate - weight : 1000 + weight - candidate
    const style = request.style ?? 'normal', otherStyle = other.style ?? 'normal'
    return (style === otherStyle ? 0 : style !== 'normal' && otherStyle !== 'normal' ? 10000 : 20000) + distance
  }
  return choices.filter(choice => choice.request.family.trim().toLowerCase() === request.family.trim().toLowerCase()).sort((a, b) => rank(a.request) - rank(b.request))[0]?.value
}

/** 通用族与同名样式匹配属于发行策略，宿主只列举目录和读取选定 ID。 */
export function matchFontFace(platform: 'win32' | 'darwin', request: TextFontRequest, faces: readonly FontFaceInfo[]): FontFaceInfo | undefined {
  const generic: Record<string, string> = platform === 'win32' ? { 'sans-serif': 'Arial', serif: 'Times New Roman', monospace: 'Consolas' } : { 'sans-serif': 'Helvetica', serif: 'Times', monospace: 'Menlo' }
  const family = generic[request.family.trim().toLowerCase()] ?? request.family
  const candidates = faces.filter(face => !face.id.startsWith('generic:') && fontMatchesName(face, family)).sort((a, b) => a.id.localeCompare(b.id))
  const name = family.toLowerCase()
  const specific = candidates.find(face => face.family.toLowerCase() !== name && face.localizedFamily.toLowerCase() !== name && (face.fullName.toLowerCase() === name || face.postscriptName.toLowerCase() === name))
  return specific ?? nearestPreparedFont({ ...request, family }, candidates.map(face => ({ request: { family, weight: face.weight, style: face.italic ? 'italic' : 'normal' }, value: face })))
}

/** revision 只由宿主用于换会话；这里的身份完整记录候选顺序、缺失项和字节哈希。 */
export class TextFontSession {
  private closed = false
  private readonly loads = new Map<string, Promise<FontCandidate>>()
  private readonly chains = new Map<string, FontChain>()
  private readonly sources = new Map<string, FontSource>()
  private readonly bytesByHash = new Map<string, ArrayBuffer>()
  private readonly preparations = new Map<string, Promise<ReadonlyMap<string, FontChain>>>()
  constructor(private readonly platform: keyof typeof defaults, private readonly read: FontReader, private readonly catalog: readonly FontFaceInfo[] | undefined, private readonly shaper: TextShaper) {}
  private load(request: TextFontRequest): Promise<FontCandidate> {
    const key = fontRequestKey(request)
    let pending = this.loads.get(key)
    if (!pending) {
      const face = this.catalog && matchFontFace(this.platform, request, this.catalog)
      pending = (this.catalog && !face ? Promise.resolve(undefined) : this.read(face ? { ...request, id: face.id } : request)).then(async result => {
        const bytes = result?.bytes
        const hash = bytes ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('') : undefined
        if (this.closed) throw new Error('字体会话已关闭，丢弃迟到字体')
        const sourceKey = JSON.stringify([hash, result?.face ?? 0, orderedValues({ ...result?.variations, ...request.variations })])
        let font = this.sources.get(sourceKey)
        if (!font && bytes && hash) {
          const sharedBytes = this.bytesByHash.get(hash) ?? bytes
          this.bytesByHash.set(hash, sharedBytes)
          font = Object.freeze({ bytes: sharedBytes, hash, face: result?.face ?? 0, variations: Object.freeze({ ...result?.variations, ...request.variations }) }); this.sources.set(sourceKey, font)
        }
        return Object.freeze({ family: request.family, font })
      })
      this.loads.set(key, pending)
      // 加载失败可重试；缺失候选则是该会话的稳定事实。
      void pending.catch(() => { if (this.loads.get(key) === pending) this.loads.delete(key) })
    }
    return pending
  }
  async prepare(declaration: TextFontDeclaration = {}, signal?: AbortSignal): Promise<ReadonlyMap<string, FontChain>> {
    if (this.closed) throw new Error('字体会话已经关闭')
    signal?.throwIfAborted()
    const key = JSON.stringify(declaration)
    let work = this.preparations.get(key)
    if (work) { this.preparations.delete(key); this.preparations.set(key, work) }
    else {
      work = this.prepareDeclaration(declaration)
      this.preparations.set(key, work)
      while (this.preparations.size > 128) this.preparations.delete(this.preparations.keys().next().value!)
      void work.catch(() => { if (this.preparations.get(key) === work) this.preparations.delete(key) })
    }
    if (!signal) return work
    return new Promise((resolve, reject) => {
      const abort = (): void => reject(signal.reason)
      signal.addEventListener('abort', abort, { once: true })
      void work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    })
  }
  private async prepareDeclaration(declaration: TextFontDeclaration): Promise<ReadonlyMap<string, FontChain>> {
    const requests = declaration.faces?.length ? declaration.faces : [{ family: 'sans-serif' }]
    const prepared = new Map<string, FontChain>()
    return Promise.all(requests.map(async request => {
      const fallback = defaultTextFonts(this.platform, declaration).map(candidate => ({ ...candidate, weight: request.weight ?? 400, style: request.style ?? 'normal', variations: request.variations }))
      const candidates = [request, ...fallback].filter((item, index, all) => all.findIndex(other => fontRequestKey(other) === fontRequestKey(item)) === index)
      const resolved = new Map<string, FontCandidate>()
      const load = async (candidate: TextFontRequest): Promise<FontCandidate> => {
        const value = await this.load(candidate); resolved.set(fontRequestKey(candidate), value); return value
      }
      await load(request)
      const text = declaration.text?.join('') ?? ''
      const graphemes = [...new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(text)].map(value => value.segment)
      for (const grapheme of new Set(graphemes)) {
        const order = this.order(request, grapheme)
        for (const candidate of order) {
          const value = await load(candidate)
          if (!value.font) continue
          const shaped = this.shaper.shape(value.font, grapheme, { size: 16 })
          if (shaped.glyphs.length && shaped.glyphs.every(glyph => glyph.id !== 0)) break
        }
      }
      // 显式书写系统预热其固定候选；实际文字仍按字素自己的次序选脸。
      for (const candidate of declaration.text === undefined || declaration.scripts?.length ? fallback : []) await load(candidate)
      if (this.closed) throw new Error('字体会话已经关闭')
      const all = [...new Map([...candidates, ...[...resolved.keys()].map(key => { const [family, weight, style] = JSON.parse(key) as [string, number, TextFontRequest['style']]; return { family, weight, style, variations: request.variations } })].map(candidate => [fontRequestKey(candidate), candidate])).values()]
      const identity = JSON.stringify([fontRequestKey(request), this.platform, all.map(candidate => { const value = resolved.get(fontRequestKey(candidate)); return [fontRequestKey(candidate), value?.font?.hash ?? (value ? null : 'unloaded'), value?.font?.face ?? null, orderedValues(value?.font?.variations)] })])
      const chain = Object.freeze({ identity, request, candidates: Object.freeze(all.flatMap(candidate => { const value = resolved.get(fontRequestKey(candidate)); return value ? [value] : [] })) })
      this.chains.set(fontRequestKey(request), chain); prepared.set(fontRequestKey(request), chain)
    })).then(() => prepared as ReadonlyMap<string, FontChain>)
  }
  matchPrepared(request: TextFontRequest, chains: ReadonlyMap<string, FontChain>): FontChain | undefined {
    return chains.get(fontRequestKey(request)) ?? nearestPreparedFont(request, [...chains.values()].flatMap(chain => chain.request ? [{ request: chain.request, value: chain }] : []))
  }
  private order(request: TextFontRequest, grapheme: string): TextFontRequest[] {
    const fallback = defaultTextFonts(this.platform, { text: [grapheme] }).map(candidate => ({ ...candidate, weight: request.weight ?? 400, style: request.style ?? 'normal', variations: request.variations }))
    const candidates = [request, ...fallback].filter((value, index, all) => all.findIndex(other => fontRequestKey(other) === fontRequestKey(value)) === index)
    const emoji = this.platform === 'win32' ? 'Segoe UI Emoji' : 'Apple Color Emoji'
    return !grapheme.includes('\ufe0e') && /\p{Emoji_Presentation}|\ufe0f|\u20e3/u.test(grapheme) ? [...candidates.filter(value => value.family === emoji), ...candidates.filter(value => value.family !== emoji)] : candidates
  }
  chain(request: TextFontRequest = { family: 'sans-serif' }): FontChain {
    if (this.closed) throw new Error('字体会话已经关闭')
    const chain = this.chains.get(fontRequestKey(request))
    if (!chain) throw new Error(`字体尚未声明并准备：${request.family}`)
    return chain
  }
  choose(chain: FontChain, grapheme: string, shaper: TextShaper, options: ShapeOptions): { font: FontSource; missing: boolean } {
    if (this.closed) throw new Error('字体会话已经关闭')
    // tab 与换行由段落处理，不是可用 cmap 查询的可见字形；制表位归属请求字体。
    if (/^[\t\r\n]+$/.test(grapheme)) {
      const primary = chain.candidates.find(candidate => candidate.font)?.font
      if (primary) return { font: primary, missing: false }
    }
    let fallback: FontSource | undefined, bestCoverage = -1
    const colorEmoji = !grapheme.includes('\ufe0e') && /\p{Emoji_Presentation}|\ufe0f|\u20e3/u.test(grapheme)
    const preferred = colorEmoji ? chain.candidates.find(candidate => candidate.family === (this.platform === 'win32' ? 'Segoe UI Emoji' : 'Apple Color Emoji')) : undefined
    const candidates = chain.request ? this.order(chain.request, grapheme).flatMap(request => chain.candidates.filter(candidate => candidate.family.toLowerCase() === request.family.toLowerCase())) : preferred ? [preferred, ...chain.candidates.filter(candidate => candidate !== preferred)] : chain.candidates
    const base = grapheme.replace(/[\p{Mark}\p{Default_Ignorable_Code_Point}]/gu, '')
    for (const candidate of candidates) if (candidate.font) {
      const result = shaper.shape(candidate.font, grapheme, options)
      if (result.glyphs.length && result.glyphs.every(glyph => glyph.id !== 0)) return { font: candidate.font, missing: false }
      // 无整簇覆盖时优先保住主体；组合符缺失不能让完整 emoji 主体退回首字体的方框。
      const baseResult = shaper.shape(candidate.font, base || grapheme, options)
      const coverage = baseResult.glyphs.filter(glyph => glyph.id !== 0).length / Math.max(1, baseResult.glyphs.length)
      // emoji 呈现必须保留彩色脸；某个组合音标缺失时仍整簇绘制，并显式报告缺字。
      if (candidate === preferred && coverage === 1) return { font: candidate.font, missing: true }
      if (coverage > bestCoverage) { bestCoverage = coverage; fallback = candidate.font }
    }
    if (!fallback) throw new Error('默认字体及全部回退候选均不可用')
    return { font: fallback, missing: true }
  }
  close(): void { this.closed = true; this.shaper.dispose(); this.loads.clear(); this.chains.clear(); this.sources.clear(); this.bytesByHash.clear(); this.preparations.clear() }
}
