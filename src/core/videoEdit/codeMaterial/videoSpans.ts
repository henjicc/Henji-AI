import type { CodeVideoSpan } from '../../imaging/parameterTypes'

/** 一个视频参数取帧时间表最多的段数：覆盖逐句停住、跳过与快放的录屏讲解，又让每帧二分查找与会话身份保持轻量。 */
export const CODE_VIDEO_SPAN_LIMIT = 512

/** 时间表的次序与范围问题（字段形状另行校验）；合法时 undefined。 */
export function codeVideoSpansIssue(spans: readonly CodeVideoSpan[]): string | undefined {
  if (!spans.length || spans.length > CODE_VIDEO_SPAN_LIMIT) return `spans 需要 1–${CODE_VIDEO_SPAN_LIMIT} 段。`
  for (let index = 0; index < spans.length; index++) {
    const span = spans[index]
    if (!(span.from < span.to)) return `spans[${index}] 需要 from < to。`
    if (index && span.from < spans[index - 1].to) return `spans[${index}] 必须按 from 升序排列，且不与前一段重叠。`
  }
  return undefined
}

/** 第一个 to > t 的段的下标（没有时为段数）；时间表按 from 升序且不重叠，to 也随之升序。 */
export function codeVideoSpanIndex(spans: readonly CodeVideoSpan[], t: number): number {
  let low = 0, high = spans.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (spans[middle].to > t) high = middle
    else low = middle + 1
  }
  return low
}

/** t 所在的段（[from, to)）；不落在任何一段时 undefined。 */
export function codeVideoSpanAt(spans: readonly CodeVideoSpan[], t: number): CodeVideoSpan | undefined {
  const span = spans[codeVideoSpanIndex(spans, t)]
  return span && span.from <= t ? span : undefined
}
