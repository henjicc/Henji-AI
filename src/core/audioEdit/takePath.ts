/*
 * 在词序列上选一组互不重叠的删除段，使总分最高：一次看全局，不是逐条取最高分再回头修补。
 * 同一处重念常有几种删法（从不同的地方算前一遍的开头、两遍相同还是对稿回跳），它们互相重叠，只会选中一个；
 * 连续几遍重念是首尾相接的几段，可以同时选中。
 */

export interface TakeSegment {
  /** 删除的词 [first, last) */
  first: number
  last: number
  /** 这一段的分数（含证据与接缝），越高越该删 */
  weight: number
}

/** 返回选中的删除段，按位置升序。 */
export function selectTakeSegments<T extends TakeSegment>(wordCount: number, segments: readonly T[]): T[] {
  const byLast = new Map<number, T[]>()
  for (const segment of segments) {
    if (segment.last <= segment.first || segment.first < 0 || segment.last > wordCount || !(segment.weight > 0)) continue
    const list = byLast.get(segment.last)
    if (list) list.push(segment); else byLast.set(segment.last, [segment])
  }
  // best[p]：只看前 p 个词时能拿到的最高总分
  const best = new Float64Array(wordCount + 1)
  const via: Array<T | undefined> = new Array(wordCount + 1)
  for (let p = 1; p <= wordCount; p++) {
    best[p] = best[p - 1]
    for (const segment of byLast.get(p) ?? []) {
      const value = best[segment.first] + segment.weight
      if (value > best[p]) { best[p] = value; via[p] = segment }
    }
  }
  const chosen: T[] = []
  for (let p = wordCount; p > 0;) {
    const segment = via[p]
    if (segment) { chosen.push(segment); p = segment.first } else p--
  }
  return chosen.reverse()
}
