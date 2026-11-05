import bidiFactory from 'bidi-js'

export type BaseDirection = 'auto' | 'ltr' | 'rtl'
export interface BidiLevels { readonly levels: Uint8Array; readonly paragraphs: readonly { start: number; end: number; level: number }[] }

const bidi = bidiFactory()
const farRightToLeft = /[\u{10800}-\u{10fff}\u{1e800}-\u{1efff}]/u
// 只有这些字符才可能产生非零层级；纯中英文段落每帧重排时不必走完整算法。
const rightToLeft = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc\u200f\u202b\u202e\u2067\u{10800}-\u{10fff}\u{1e800}-\u{1efff}]/u

// bidi-js 按 UTF-16 单元查方向类别，非基本平面字符一律当成从左到右；换成同类别的占位，长度不变。
const basicPlaneStandIn = (text: string): string => text.replace(/[\u{10000}-\u{10ffff}]/gu, char => {
  if (farRightToLeft.test(char)) return '\u05d0\u05d0'
  return /\p{Extended_Pictographic}/u.test(char) ? '\u2605\u2605' : char
})

/** 按 UAX #9 求每个 UTF-16 单元的层级；整段都是第 0 层时返回 undefined。 */
export function resolveBidi(text: string, base: BaseDirection): BidiLevels | undefined {
  if (base !== 'rtl' && !rightToLeft.test(text)) return undefined
  return bidi.getEmbeddingLevels(basicPlaneStandIn(text), base === 'auto' ? undefined : base)
}

/** UAX #9 L2：从最高层到最低奇数层，逐层翻转连续片段，得到显示顺序。 */
export function visualOrder<T extends { readonly level: number }>(items: readonly T[]): T[] {
  const ordered = [...items], odd = items.map(item => item.level).filter(level => level % 2 === 1)
  if (!odd.length) return ordered
  const lowest = Math.min(...odd), highest = Math.max(...items.map(item => item.level))
  for (let level = highest; level >= lowest; level--) {
    for (let i = 0; i < ordered.length; i++) {
      if (ordered[i].level < level) continue
      let end = i
      while (end + 1 < ordered.length && ordered[end + 1].level >= level) end++
      ordered.splice(i, end - i + 1, ...ordered.slice(i, end + 1).reverse())
      i = end
    }
  }
  return ordered
}
