import { soundBrightnessLabel, type SoundFeatures } from './soundFeatures'
import { cosineSimilarity } from './clapFeatures'

/*
 * 音效检索打分：名字匹配 + 时长等数据过滤，模型就绪时再融合“听音”分（CLAP 文本—音频相似度）。
 *
 * 名字：英文部分可靠，中文常是机翻，所以英文命中权重高、中文命中略低、文件夹名只算弱依据。
 * 常见音效词的英文近义词组内置一份（whoosh/swoosh/swish…），省得助手把每个同义词都列一遍。
 *
 * 听音阈值按真实音效库（669 条，2026-10-21）标定，见 soundSearch.test.ts 与提交说明：
 * 余弦低于 LISTEN_FLOOR 的候选不算“听起来像”；最佳候选都低于 LISTEN_MATCH 且名字也没命中时判定“没有合适的”。
 */

export interface SoundIndexEntry {
  id: string
  folderId: string
  /** 相对登记文件夹的路径（用 / 分隔），只在宿主内部与界面显示用。 */
  relativePath: string
  label: string
  english: string | null
  chinese: string | null
  englishWords: string[]
  folderTerms: string[]
  features: SoundFeatures
  /** 已归一的 CLAP 音频向量；模型未下载或尚未计算时缺省。 */
  embedding?: Float32Array
}

export interface SoundSearchQuery {
  /** 名字关键词（中英文均可，互为备选，命中任一个即可）。 */
  keywords: readonly string[]
  /** 已归一的英文描述文本向量；没有描述或模型未就绪时缺省。 */
  descriptionEmbedding?: Float32Array
  minDurationSeconds?: number
  maxDurationSeconds?: number
  /** 击中点最晚在声音的第几秒（需要提前量很短的音效时用）。 */
  maxHitSeconds?: number
  brightness?: 'dark' | 'neutral' | 'bright'
  limit: number
}

export interface SoundSearchHit {
  entry: SoundIndexEntry
  score: number
  nameScore: number
  /** 听音余弦相似度；未参与时为 null。 */
  listenScore: number | null
  matchedBy: Array<'name' | 'listening'>
}

export interface SoundSearchResult {
  hits: SoundSearchHit[]
  /** 结果不足以采用：名字没命中，听音也都不够像。 */
  noGoodMatch: boolean
  /** 满足过滤条件的候选总数。 */
  considered: number
}

export const LISTEN_FLOOR = 0.15
export const LISTEN_MATCH = 0.25
/** 名字命中门槛：多词关键词只命中一半（“car horn”对“Car Door”）不算。 */
export const NAME_MATCH = 0.75
const LISTEN_SPAN = 0.3
const NAME_WEIGHT = 0.4

const SYNONYMS: readonly (readonly string[])[] = [
  ['whoosh', 'woosh', 'swoosh', 'swish', 'swipe', 'swing', 'pass', 'passby', 'whip', 'flyby'],
  ['hit', 'impact', 'punch', 'thud', 'slam', 'smack', 'knock', 'strike', 'thump'],
  ['ding', 'ping', 'bing', 'chime', 'bell', 'bells', 'chimes', 'notification'],
  ['click', 'tap', 'tick', 'button', 'keyboard', 'mouse', 'typing', 'type'],
  ['pop', 'blob', 'blop', 'bubble', 'plop'],
  ['riser', 'rise', 'rising', 'build', 'uplifter', 'sweep'],
  ['boom', 'explosion', 'explode', 'blast', 'implosion'],
  ['glitch', 'static', 'noise', 'digital', 'data', 'electro', 'electronic'],
  ['water', 'drop', 'drops', 'splash', 'drip'],
  ['boing', 'spring', 'bounce', 'bouncy'],
  ['metal', 'metallic', 'iron', 'clang', 'steel'],
  ['footstep', 'footsteps', 'step', 'steps'],
]
const SYNONYM_GROUP = new Map(SYNONYMS.flatMap((group, index) => group.map(word => [word, index] as const)))
const HAN = /\p{Script=Han}/u

function stem(word: string): string {
  return word.length > 4 ? word.replace(/(ing|es|s)$/, '') : word
}

function termScore(term: string, entry: SoundIndexEntry): number {
  if (HAN.test(term)) {
    // 命中占中文名比例越高越靠前（“嗖02”更像“嗖02-短”而不是“简单的嗖嗖02”）。
    if (entry.chinese?.includes(term)) return 0.8 + 0.1 * term.length / entry.chinese.replace(/\s/g, '').length
    return entry.folderTerms.some(folder => folder.includes(term)) ? 0.4 : 0
  }
  const words = term.toLowerCase().split(/[^a-z0-9']+/).filter(word => /[a-z]/.test(word))
  if (!words.length) return 0
  // 多词关键词按词平均：“metal hit”两个词都命中才算满分。
  const per = words.map((word): number => {
    const wanted = stem(word)
    if (entry.englishWords.some(own => stem(own) === wanted)) return 1
    if (entry.englishWords.some(own => own.length >= 4 && wanted.length >= 4 && (own.startsWith(wanted) || wanted.startsWith(own)))) return 0.9
    const group = SYNONYM_GROUP.get(word) ?? SYNONYM_GROUP.get(wanted)
    if (group !== undefined && entry.englishWords.some(own => SYNONYM_GROUP.get(own) === group || SYNONYM_GROUP.get(stem(own)) === group)) return 0.85
    return entry.folderTerms.some(folder => folder.toLowerCase().includes(word)) ? 0.4 : 0
  })
  return per.reduce((sum, value) => sum + value, 0) / per.length
}

export function soundNameScore(keywords: readonly string[], entry: SoundIndexEntry): number {
  return keywords.reduce((best, keyword) => Math.max(best, termScore(keyword.trim(), entry)), 0)
}

export function searchSoundIndex(entries: readonly SoundIndexEntry[], query: SoundSearchQuery): SoundSearchResult {
  const listening = query.descriptionEmbedding
  const candidates = entries.filter(entry => {
    const { durationSeconds, hitSeconds, brightnessHz } = entry.features
    if (query.minDurationSeconds !== undefined && durationSeconds < query.minDurationSeconds) return false
    if (query.maxDurationSeconds !== undefined && durationSeconds > query.maxDurationSeconds) return false
    if (query.maxHitSeconds !== undefined && hitSeconds > query.maxHitSeconds) return false
    if (query.brightness && soundBrightnessLabel(brightnessHz) !== query.brightness) return false
    return entry.features.peakDbfs !== null
  })
  const hits = candidates.map((entry): SoundSearchHit => {
    const nameScore = query.keywords.length ? soundNameScore(query.keywords, entry) : 0
    const listenScore = listening && entry.embedding ? cosineSimilarity(listening, entry.embedding) : null
    const listenPart = listenScore === null ? 0 : Math.max(0, Math.min(1, (listenScore - LISTEN_FLOOR) / LISTEN_SPAN))
    const score = listenScore === null ? nameScore : NAME_WEIGHT * nameScore + (1 - NAME_WEIGHT) * listenPart
    const matchedBy: SoundSearchHit['matchedBy'] = []
    if (nameScore >= NAME_MATCH) matchedBy.push('name')
    if (listenScore !== null && listenScore >= LISTEN_MATCH) matchedBy.push('listening')
    return { entry, score, nameScore, listenScore, matchedBy }
  }).filter(hit => hit.score > 0 || (!query.keywords.length && !listening))
  hits.sort((left, right) => right.score - left.score || left.entry.features.durationSeconds - right.entry.features.durationSeconds || left.entry.relativePath.localeCompare(right.entry.relativePath))
  const top = hits.slice(0, query.limit)
  const constrained = query.keywords.length > 0 || listening !== undefined
  const noGoodMatch = constrained && !top.some(hit => hit.matchedBy.length > 0)
  return { hits: top, noGoodMatch, considered: candidates.length }
}
