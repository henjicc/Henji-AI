export interface SubtitleCue { startUs: number; endUs: number; text: string }

/** Text-only SRT/WebVTT interchange. Cue clocks are integer microseconds. */
export function parseSubtitleText(source: string): SubtitleCue[] {
  if (source.length > 2 * 1024 ** 2 || new TextEncoder().encode(source).byteLength > 2 * 1024 ** 2) throw new Error('字幕文件超过2MiB。')
  const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim()
  const webvtt = /^WEBVTT(?:[ \t].*)?(?:\n|$)/.test(normalized)
  const body = webvtt ? normalized.replace(/^WEBVTT[^\n]*(?:\n[^\n]+)*?\n\n/, '') : normalized
  const clock = (value: string): number => {
    const match = /^(?:(\d{2,}):)?([0-5]\d):([0-5]\d)[,.](\d{3})$/.exec(value)
    if (!match || !webvtt && !match[1]) throw new Error(`字幕时间无效：${value}`)
    const us = ((Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3])) * 1000 + Number(match[4])) * 1000
    if (!Number.isSafeInteger(us) || us > 24 * 3600 * 1e6) throw new Error('字幕时间超出24小时范围。')
    return us
  }
  const cues: SubtitleCue[] = []
  for (const block of body.split(/\n[ \t]*\n/)) {
    const lines = block.split('\n')
    if (!block.trim() || webvtt && /^(?:WEBVTT|NOTE(?:[ \t]|$)|STYLE$|REGION$)/.test(lines[0])) continue
    const timingIndex = lines[0].includes('-->') ? 0 : 1
    const timing = /^\s*(\S+)\s+-->\s+(\S+)(?:[ \t]+.*)?$/.exec(lines[timingIndex] ?? '')
    if (!timing) throw new Error(`字幕段${cues.length + 1}缺少有效时间。`)
    const startUs = clock(timing[1]); const endUs = clock(timing[2])
    const rawText = lines.slice(timingIndex + 1).join('\n')
    if (rawText.length > 32768) throw new Error(`字幕段${cues.length + 1}原始文字超过32KiB。`)
    const text = rawText.replace(/<[^<>]*>/g, '').replace(/&(amp|lt|gt|nbsp|quot);/g, (_, entity: string) => ({ amp: '&', lt: '<', gt: '>', nbsp: ' ', quot: '"' })[entity]!).trim()
    if (endUs <= startUs || !text || text.length > 2000) throw new Error(`字幕段${cues.length + 1}须有正时长及1至2000字的文字。`)
    cues.push({ startUs, endUs, text })
    if (cues.length > 500) throw new Error('一次最多导入500段字幕。')
  }
  if (!cues.length) throw new Error('文件中没有可导入的字幕。')
  return cues
}

export function formatSubtitleTimestampUs(us: number, format: 'srt' | 'vtt' = 'srt'): string {
  const ms = Math.max(0, Math.round(us / 1000))
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}${format === 'srt' ? ',' : '.'}${String(ms % 1000).padStart(3, '0')}`
}
export function buildSubtitleText(cues: readonly SubtitleCue[], format: 'srt' | 'vtt' = 'srt'): string {
  const text = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n{2,}/g, '\n')
  return (format === 'vtt' ? 'WEBVTT\n\n' : '') + cues.map((cue, index) => `${format === 'srt' ? `${index + 1}\n` : ''}${formatSubtitleTimestampUs(cue.startUs, format)} --> ${formatSubtitleTimestampUs(cue.endUs, format)}\n${text(cue.text)}\n`).join('\n')
}
