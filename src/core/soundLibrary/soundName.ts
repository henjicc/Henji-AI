/*
 * 音效文件名解析：收集来的音效常是“英文 - 机翻中文”或“中文   English”双语名，机翻的中文常常错
 * （Riser → 立管、Ping → 平、Pop → 流行），英文部分更可靠。两边都保留，检索时英文权重更高。
 */

export interface SoundName {
  /** 去掉扩展名的原文件名。 */
  label: string
  /** 英文部分（已整理空白与分隔符）；名字里没有英文时为 null。 */
  english: string | null
  /** 中文部分；没有中文时为 null。 */
  chinese: string | null
  /** 英文词（小写，去掉纯数字），用于名字匹配。 */
  englishWords: string[]
}

const HAN = /\p{Script=Han}/u
const HAN_RUN = /\p{Script=Han}(?:[\p{Script=Han}\d·]|[\s-]+(?=[\p{Script=Han}\d]))*/gu

function tidy(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/^[\s\-–—_.,+()]+|[\s\-–—_.,+(]+$/g, '').replace(/\s*-\s*$/, '').trim()
}

/** 同一短语重复两遍（`blop_07 - blop_07`）只保留一遍。 */
function dedupeRepeat(text: string): string {
  const parts = text.split(/\s+-\s+/)
  return parts.filter((part, index) => parts.findIndex(other => other.toLowerCase() === part.toLowerCase()) === index).join(' - ')
}

export function parseSoundName(fileName: string): SoundName {
  const label = fileName.replace(/\.[^./\\]+$/, '')
  const spaced = label.replace(/_/g, ' ')
  const chinese = tidy((spaced.match(HAN_RUN) ?? []).join(' '))
  const latin = dedupeRepeat(tidy(spaced.replace(HAN_RUN, ' ').replace(/[\p{Script=Han}]/gu, ' ')))
  const englishWords = [...new Set(latin.toLowerCase().split(/[^a-z0-9']+/).filter(word => /[a-z]/.test(word)))]
  return { label, english: englishWords.length ? latin : null, chinese: chinese && HAN.test(chinese) ? chinese : null, englishWords }
}

/** 文件夹名里的中英文词（如“转场音效300+”“电脑手机相关”“MG音效”），作为弱匹配依据。 */
export function soundFolderTerms(relativeDirectory: string): string[] {
  return relativeDirectory.split(/[\\/]+/).filter(Boolean)
}
