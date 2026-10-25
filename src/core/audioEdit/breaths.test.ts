import { describe, expect, it } from 'vitest'
import type { AudioEditProjectDocument, AudioEditTranscriptBlock } from './types'
import { applyAudioEditBreathPolicy, AUDIO_EDIT_BREATH_ATTENUATION_DB, describeAudioEditBreaths } from './breaths'

/** 采样率 1000：帧即毫秒 */
function documentOf(words: Array<[string, number, number]>, extra: Partial<AudioEditProjectDocument> = {}): AudioEditProjectDocument {
  const transcript: AudioEditTranscriptBlock[] = words.map(([text, startFrame, endFrame], index) => ({ id: `w${index}`, text, startFrame, endFrame, included: true, locked: false, granularity: 'word' }))
  return {
    id: 'breaths', name: '呼吸', referenceScript: '', suggestions: [], vstEnabled: false, transcript, createdAt: 1, updatedAt: 1, revision: 1,
    source: { mediaType: 'audio', sourcePath: 'a.wav', audioPath: 'a.wav', durationFrames: 20000, sampleRate: 1000, channels: 1 },
    cuts: [], gainRegions: [], ...extra,
  }
}

// 0–1000 一件事。 | 呼吸 1300–1700 | 2000– 每个回答， | 呼吸 3150–3400 | 3500– 都是 | 呼吸 4900–5300（压着“节点”）
const words: Array<[string, number, number]> = [['一件事。', 0, 1000], ['每个', 2000, 2500], ['回答，', 2500, 3000], ['都是', 3500, 4000], ['这样的', 4000, 4800], ['节点', 4800, 5400], ['结束。', 5600, 6000]]
const breaths = [
  { startMs: 1300, endMs: 1700, peak: 1 },
  { startMs: 3150, endMs: 3400, peak: 0.9 },
  { startMs: 4900, endMs: 5300, peak: 0.8 },
]

describe('呼吸声按上下文处理', () => {
  it('快节奏：句间与句中的呼吸都删掉、两侧原有的安静保留；压着字的不动刀', () => {
    const document = documentOf(words)
    const views = describeAudioEditBreaths(document, breaths)
    expect(views.map((view) => view.context)).toEqual(['sentence', 'clause', 'touching'])
    expect(views[0]).toMatchObject({ before: expect.stringContaining('一件事。'), after: expect.stringContaining('每个'), gapMs: 1000, handling: 'kept' })
    const { document: next, counts } = applyAudioEditBreathPolicy(document, breaths, 'delete')
    expect(counts).toEqual({ deleted: 2, attenuated: 0, muted: 0, kept: 1 })
    expect(next.cuts).toEqual([
      { id: 'breath:1300', startFrame: 1300, endFrame: 1700, reason: 'silence', enabled: true },
      { id: 'breath:3150', startFrame: 3150, endFrame: 3400, reason: 'silence', enabled: true },
    ])
    expect(describeAudioEditBreaths(next, breaths).map((view) => view.handling)).toEqual(['deleted', 'deleted', 'kept'])
    // 全部减弱时用 -18 dB 的音量区域
    expect(applyAudioEditBreathPolicy(document, breaths, 'attenuate').document.gainRegions?.[0]).toMatchObject({ id: 'breath:1300', gainDb: AUDIO_EDIT_BREATH_ATTENUATION_DB })
  })

  it('删了会让前后的字之间少于约 0.12 秒气口时改为减弱', () => {
    const tight = documentOf([['一件事。', 0, 1000], ['每个', 1350, 1800]])
    const { counts } = applyAudioEditBreathPolicy(tight, [{ startMs: 1020, endMs: 1300, peak: 1 }], 'delete')
    expect(counts).toMatchObject({ deleted: 0, attenuated: 1 })
  })

  it('已被重念或停顿处理剪掉的呼吸不再处理；下刀范围只在两侧词之间', () => {
    const cut = documentOf(words, { cuts: [{ id: 'retake', startFrame: 1200, endFrame: 1800, reason: 'manual', enabled: true }] })
    expect(describeAudioEditBreaths(cut, breaths)[0]).toMatchObject({ context: 'removed', handling: 'removed' })
    expect(applyAudioEditBreathPolicy(cut, breaths.slice(0, 1), 'delete').counts).toEqual({ deleted: 0, attenuated: 0, muted: 0, kept: 0 })
    const near = documentOf(words)
    near.transcript[1] = { ...near.transcript[1], startFrame: 1600 }
    expect(applyAudioEditBreathPolicy(near, breaths.slice(0, 1), 'delete').document.cuts).toEqual([expect.objectContaining({ startFrame: 1300, endFrame: 1600 })])
  })

  it('全部减弱、全部静音、保留；重跑替换此前的呼吸处理，用户逐处恢复过的不再动', () => {
    const document = documentOf(words)
    expect(applyAudioEditBreathPolicy(document, breaths, 'attenuate').counts.attenuated).toBe(2)
    const muted = applyAudioEditBreathPolicy(document, breaths, 'mute').document
    expect(muted.cuts?.map((cut) => cut.mode)).toEqual(['mute', 'mute'])
    const deleted = applyAudioEditBreathPolicy(document, breaths, 'delete').document
    const kept = applyAudioEditBreathPolicy(deleted, breaths, 'keep').document
    expect(kept.cuts).toEqual([])
    expect(kept.gainRegions).toEqual([])
    const userRestored = { ...deleted, cuts: deleted.cuts!.map((cut) => ({ ...cut, enabled: false })) }
    const again = applyAudioEditBreathPolicy(userRestored, breaths, 'delete').document
    expect(again.cuts?.map((cut) => [cut.id, cut.enabled])).toEqual([['breath:1300', false], ['breath:3150', false]])
  })
})

describe('逐处改一口气的处理', () => {
  it('删、减弱、静音、保留都替换这一处原来的处理；保留之后批量处理不再动它', async () => {
    const { setAudioEditBreathHandling } = await import('./breaths')
    const document = documentOf(words)
    const deleted = setAudioEditBreathHandling(document, breaths, 'breath:3150', 'deleted')
    expect(deleted.cuts).toEqual([expect.objectContaining({ id: 'breath:3150', enabled: true })])
    const softened = setAudioEditBreathHandling(deleted, breaths, 'breath:3150', 'attenuated')
    expect(softened.cuts).toEqual([])
    expect(softened.gainRegions).toEqual([expect.objectContaining({ id: 'breath:3150' })])
    const kept = setAudioEditBreathHandling(softened, breaths, 'breath:1300', 'kept')
    expect(describeAudioEditBreaths(kept, breaths)[0].handling).toBe('kept')
    expect(applyAudioEditBreathPolicy(kept, breaths, 'delete').document.cuts?.find((cut) => cut.id === 'breath:1300')?.enabled).toBe(false)
    expect(() => setAudioEditBreathHandling(document, breaths, 'breath:4900', 'deleted')).toThrow(/连在一起/)
    expect(() => setAudioEditBreathHandling(document, breaths, 'breath:9999', 'deleted')).toThrow('NOT_FOUND')
  })
})
