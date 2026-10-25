import { describe, expect, it } from 'vitest'
import type { AudioEditProjectDocument, AudioEditTranscriptBlock } from './types'
import { cleanAudioEditGaps, clearAudioEditGaps } from './gaps'
import { buildProjectAudioEditTimeline } from './timeline'

/** 采样率 1000：帧即毫秒；电平每 10 ms 一格 */
function documentOf(words: Array<[string, number, number]>, extra: Partial<AudioEditProjectDocument> = {}): AudioEditProjectDocument {
  const transcript: AudioEditTranscriptBlock[] = words.map(([text, startFrame, endFrame], index) => ({ id: `w${index}`, text, startFrame, endFrame, included: true, locked: false, granularity: 'word' }))
  return {
    id: 'gaps', name: '气口', referenceScript: '', suggestions: [], vstEnabled: false, transcript, createdAt: 1, updatedAt: 1, revision: 1,
    source: { mediaType: 'audio', sourcePath: 'a.wav', audioPath: 'a.wav', durationFrames: 4000, sampleRate: 1000, channels: 1 },
    cuts: [], gainRegions: [], ...extra,
  }
}
/** 说话 -30 dB，其余是 -60 dB 的残留气声；sound 里列出有声的毫秒区间 */
function levelsOf(sound: Array<[number, number]>, extra: Array<[number, number, number]> = []): { resolutionMs: number; wideDb: number[] } {
  const wideDb: number[] = Array.from({ length: 400 }, (_, cell) => (sound.some(([a, b]) => cell * 10 >= a && cell * 10 < b) ? -30 : -60))
  for (const [a, b, db] of extra) for (let cell = a / 10; cell < b / 10; cell++) wideDb[cell] = db
  return { resolutionMs: 10, wideDb }
}
const heardBetween = (document: AudioEditProjectDocument, from: number, to: number): { heard: number; silent: number } => {
  let heard = 0, silent = 0
  for (const span of buildProjectAudioEditTimeline(document)) {
    const overlap = Math.max(0, Math.min(to, span.sourceEndFrame) - Math.max(from, span.sourceStartFrame))
    heard += overlap; if (span.muted) silent += overlap
  }
  return { heard, silent }
}

describe('字间气口清理', () => {
  it('句中：按电平找到字真正的起止，中间先静音、再从中间删掉多余的，只留约 0.12 秒干净的静音', () => {
    // 一件事， 0–1000（余音到 1020） | 1020–1400 残留气声 | 每个 1400–1800
    const document = documentOf([['一件事，', 0, 1000], ['每个', 1400, 1800], ['回答', 1800, 3000]])
    const levels = levelsOf([[0, 1020], [1400, 3000]])
    const { document: next, count } = cleanAudioEditGaps(document, [], levels)
    expect(count).toBe(1)
    expect(next.cuts).toEqual([
      { id: 'gap:1020', startFrame: 1040, endFrame: 1085, reason: 'silence', enabled: true, mode: 'mute' },
      { id: 'gap:1020:1', startFrame: 1085, endFrame: 1345, reason: 'silence', enabled: true },
      { id: 'gap:1020:2', startFrame: 1345, endFrame: 1390, reason: 'silence', enabled: true, mode: 'mute' },
    ])
    // 剪完：字的余音 20 + 静音 90 + 字前 10 = 120
    expect(heardBetween(next, 1000, 1400)).toEqual({ heard: 140, silent: 90 })
  })

  it('句间与重念接缝留约 0.2 秒；本来就短的气口只静音不删；连着念的字之间不动', () => {
    const sentence = cleanAudioEditGaps(documentOf([['一件事。', 0, 1000], ['每个', 1400, 3000]]), [], levelsOf([[0, 1020], [1400, 3000]])).document
    expect(heardBetween(sentence, 1020, 1400).heard).toBe(200)
    const short = cleanAudioEditGaps(documentOf([['一件事，', 0, 1000], ['每个', 1100, 3000]]), [], levelsOf([[0, 1020], [1100, 3000]])).document
    expect(short.cuts).toEqual([{ id: 'gap:1020', startFrame: 1040, endFrame: 1090, reason: 'silence', enabled: true, mode: 'mute' }])
    const joined = cleanAudioEditGaps(documentOf([['一件', 0, 1000], ['事', 1000, 3000]]), [], levelsOf([[0, 3000]]))
    expect(joined.count).toBe(0)
  })

  it('重念接缝：两侧剩下的残留按成片里的先后连成一段处理，检测到的呼吸算残留', () => {
    // 额度啊， 0–1000 | 残留 1000–1100 | 念坏的“所以” 1100–1500（已删）| 呼吸 1500–1800 | 所以 1900–
    const document = documentOf([['额度啊，', 0, 1000], ['所以', 1100, 1500], ['所以我就', 1900, 3000]], {
      cuts: [{ id: 'retake', startFrame: 1500, endFrame: 1700, reason: 'silence', enabled: true }],
    })
    document.transcript[1] = { ...document.transcript[1], included: false }
    const levels = levelsOf([[0, 1000], [1100, 1500], [1900, 3000]], [[1500, 1800, -45]])
    const { document: next } = cleanAudioEditGaps(document, [{ startMs: 1500, endMs: 1800, peak: 1 }], levels)
    // 听到的：残留 100 + 呼吸与安静 200 = 300 → 接缝留 200，全是静音（字的保护段之外）
    expect(heardBetween(next, 1000, 1900)).toEqual({ heard: 200, silent: 170 })
  })

  it('夹在残留里的几十毫秒声响一并静音；重跑替换上一次；逐处恢复过的不动；锁定的不动', () => {
    const document = documentOf([['一件事，', 0, 1000], ['每个', 1400, 3000]])
    const levels = levelsOf([[0, 1020], [1400, 3000], [1200, 1220]])
    const first = cleanAudioEditGaps(document, [], levels).document
    expect(first.cuts!.every((cut) => cut.id.startsWith('gap:1020'))).toBe(true)
    expect(heardBetween(first, 1000, 1400).heard).toBe(140)
    expect(cleanAudioEditGaps(first, [], levels).document.cuts).toEqual(first.cuts)
    const restored = { ...first, cuts: first.cuts!.map((cut) => ({ ...cut, enabled: false })) }
    expect(cleanAudioEditGaps(restored, [], levels).count).toBe(0)
    const locked = documentOf([['一件事，', 0, 1000], ['每个', 1400, 3000]])
    locked.transcript[1] = { ...locked.transcript[1], startFrame: 1100, locked: true }
    expect(cleanAudioEditGaps(locked, [], levels).count).toBe(0)
    expect(clearAudioEditGaps(first).cuts).toEqual([])
  })
})
