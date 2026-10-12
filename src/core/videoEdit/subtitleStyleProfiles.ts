import { z } from 'zod'

/** Netflix zh-Hans plus the user's zero-gap/punctuation policy. No English profile yet. */
export const SUBTITLE_STYLE_PROFILES = {
  netflix_zh_hans: { maxCharacters: 16, maxLines: 2, minDurationSeconds: 5 / 6, maxDurationSeconds: 7, maxReadingSpeed: 9, joinGapMs: 500, punctuation: 'netflix_zh_hans' as const },
  custom: { maxCharacters: 24, maxLines: 2, minDurationSeconds: 1, maxDurationSeconds: 7, maxReadingSpeed: 9, joinGapMs: 500, punctuation: 'preserve' as const },
}
export const subtitleStyleOptionsSchema = z.object({
  style: z.enum(['netflix_zh_hans', 'custom']).default('netflix_zh_hans').describe('字幕规范；中文默认 Netflix 简体中文，英语沿用原有排版。'),
  maxCharacters: z.number().int().positive().optional().describe('覆盖每行字宽；中文一字，半角字符半字。'),
  maxLines: z.number().int().positive().optional().describe('覆盖每条字幕最多行数。'),
  minDurationSeconds: z.number().nonnegative().optional().describe('覆盖最短显示秒数；默认 5/6 秒，受可用声音范围限制。'),
  maxDurationSeconds: z.number().positive().optional().describe('覆盖最长显示秒数，默认 7 秒。'),
  maxReadingSpeed: z.number().positive().optional().describe('覆盖最大阅读字宽/秒，默认成人 9。'),
  joinGapMs: z.number().nonnegative().optional().describe('小于此毫秒数的字幕间隙接为零，默认 500。'),
  punctuation: z.enum(['netflix_zh_hans', 'preserve']).optional().describe('标点策略；Netflix 简体中文去掉逗号句号，保留问号、感叹号、省略号及句中顿号。'),
  pauseSeconds: z.number().positive().optional().describe('省略按词间停顿分布自适应；可指定气口阈值，TTS 通常约 0.2–0.3 秒。'),
}).strict()
export type SubtitleStyleOptions = z.input<typeof subtitleStyleOptionsSchema>
export function resolveSubtitleStyle(options: SubtitleStyleOptions = {}, text = '') {
  const parsed = subtitleStyleOptionsSchema.parse(options)
  const profile = SUBTITLE_STYLE_PROFILES[parsed.style]
  const overrides = Object.fromEntries(Object.entries(parsed).filter(([, value]) => value !== undefined))
  const settings = { ...profile, ...overrides } as typeof profile & { style: 'netflix_zh_hans' | 'custom'; pauseSeconds?: number }
  if (settings.minDurationSeconds > settings.maxDurationSeconds) throw new Error('minDurationSeconds 不得大于 maxDurationSeconds。')
  return { ...settings, chinese: /\p{Script=Han}/u.test(text) }
}
export function subtitleWidth(text: string): number {
  return Array.from(text).reduce((sum, char) => sum + (/\r|\n/u.test(char) ? 0 : char.codePointAt(0)! <= 0x7f || /[\uff61-\uffdc]/u.test(char) ? .5 : 1), 0)
}
export function normalizeSubtitlePunctuation(text: string, policy: 'netflix_zh_hans' | 'preserve'): string {
  if (policy === 'preserve') return text.trim()
  return text.replace(/[，。,.;；:：—]+/gu, ' ').replace(/[^\S\n]+/gu, ' ').replace(/[ 、]+(?=\n|$)/gu, '').trim()
}

/** Positive gaps only: zero-gap liaison must not collapse the speaker's pause distribution. */
export function adaptiveSubtitlePause(gapsMs: readonly number[], overrideSeconds?: number): number {
  if (overrideSeconds !== undefined) return overrideSeconds * 1000
  const positive = gapsMs.filter(gap => gap > 0).sort((a, b) => a - b)
  if (!positive.length) return Infinity
  const median = positive[Math.floor((positive.length - 1) / 2)]
  return median * 1.75
}
