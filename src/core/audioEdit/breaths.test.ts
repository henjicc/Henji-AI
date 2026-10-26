import { describe, expect, it } from 'vitest'
import type { AudioEditProjectDocument, AudioEditTranscriptBlock } from './types'
import { applyAudioEditBreathPolicy, AUDIO_EDIT_BREATH_ATTENUATION_DB, describeAudioEditBreaths } from './breaths'

/** 采样率 1000：帧即毫秒 */
function documentOf(words: Array<[string, number, number]>, extra: Partial<AudioEditProjectDocument> = {}): AudioEditProjectDocument {
  const transcript: AudioEditTranscriptBlock[] = words.map(([text, startFrame, endFrame], index) => ({ id: `w${index}`, text, startFrame, endFrame, included: true, locked: false, granularity: 'word' }))
  return {
    id: 'breaths', name: '呼吸', referenceScript: '', suggestions: [], transcript, createdAt: 1, updatedAt: 1, revision: 1,
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

  it('删完前后的字之间不到约 0.08 秒时，只删前面大半口气、留紧挨下一个字的一小截并减弱', () => {
    const tight = documentOf([['一件事，', 0, 1000], ['每个', 1310, 1800]])
    const { document: next, counts } = applyAudioEditBreathPolicy(tight, [{ startMs: 1010, endMs: 1300, peak: 1 }], 'delete')
    expect(counts).toMatchObject({ deleted: 1, attenuated: 0 })
    // 空当 310，这口气 290，删完只剩 20：留最后 60 凑够 80
    expect(next.cuts).toEqual([expect.objectContaining({ id: 'breath:1010', startFrame: 1010, endFrame: 1240 })])
    expect(next.gainRegions).toEqual([expect.objectContaining({ id: 'breath:1010', startFrame: 1240, endFrame: 1300, gainDb: AUDIO_EDIT_BREATH_ATTENUATION_DB })])
    expect(describeAudioEditBreaths(next, [{ startMs: 1010, endMs: 1300, peak: 1 }])[0].handling).toBe('deleted')
    // 这口气太短、留不出可删的部分时整口减弱
    const tiny = applyAudioEditBreathPolicy(documentOf([['一件事，', 0, 1000], ['每个', 1110, 1800]]), [{ startMs: 1005, endMs: 1100, peak: 1 }], 'delete')
    expect(tiny.counts).toMatchObject({ deleted: 0, attenuated: 1 })
  })

  it('重念接缝处按剪完后听到的空当留气口：同一处的几口气逐口处理，不会把接缝删到字贴字', () => {
    // 可靠的。| 呼吸 1000–1300 | 念坏的“而且” 1300–1800（已删）+ 重念切掉的停顿 1800–2000 | 呼吸 2000–2300 | 而且正好
    const seam = documentOf([['可靠的。', 0, 1000], ['而且', 1300, 1800], ['而且正好', 2310, 2800]], {
      cuts: [{ id: 'retake', startFrame: 1800, endFrame: 2000, reason: 'silence', enabled: true }],
    })
    seam.transcript[1] = { ...seam.transcript[1], included: false }
    const pair = [{ startMs: 1000, endMs: 1300, peak: 1 }, { startMs: 2000, endMs: 2300, peak: 1 }]
    expect(describeAudioEditBreaths(seam, pair).map((view) => view.gapMs)).toEqual([610, 610])
    const { document: next, counts } = applyAudioEditBreathPolicy(seam, pair, 'delete')
    expect(counts).toMatchObject({ deleted: 2, attenuated: 0 })
    // 第一口整口删；第二口只剩 10 的安静，留最后 140 减弱，接缝听到 150
    expect(next.cuts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'breath:1000', startFrame: 1000, endFrame: 1300 }),
      expect.objectContaining({ id: 'breath:2000', startFrame: 2000, endFrame: 2160 }),
    ]))
    expect(next.gainRegions).toEqual([expect.objectContaining({ id: 'breath:2000', startFrame: 2160, endFrame: 2300 })])
    expect(describeAudioEditBreaths(next, pair).map((view) => view.gapMs)).toEqual([150, 150])
  })

  it('有能量证据时只把真正安静的部分算作气口：识别在连读的字之间留出的空当不算', () => {
    // 索引，0–1000 | 1000–1100 其实还有声音 | 呼吸 1100–1350 | 1350–1400 | 几十个
    const document = documentOf([['索引，', 0, 1000], ['几十个', 1400, 1800]])
    const breath = [{ startMs: 1100, endMs: 1350, peak: 1 }]
    // 只按词的空当算：以为还剩 150 的气口，整口删掉
    expect(applyAudioEditBreathPolicy(document, breath, 'delete').document.cuts).toEqual([expect.objectContaining({ startFrame: 1100, endFrame: 1350 })])
    // 能量证据里那段不安静：删完一点气口都没有，留紧挨下一个字的 80 减弱
    const strict = applyAudioEditBreathPolicy(document, breath, 'delete', undefined, []).document
    expect(strict.cuts).toEqual([expect.objectContaining({ startFrame: 1100, endFrame: 1270 })])
    expect(strict.gainRegions).toEqual([expect.objectContaining({ startFrame: 1270, endFrame: 1350 })])
    // 前面确有 100 的安静时照常整口删
    expect(applyAudioEditBreathPolicy(document, breath, 'delete', undefined, [{ startMs: 1000, endMs: 1100 }]).document.cuts).toEqual([expect.objectContaining({ startFrame: 1100, endFrame: 1350 })])
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

describe('呼吸声的位置判断', () => {
  it('识别的词时间只多盖了几十毫秒不算和字连在一起；一部分已被剪掉的照常按位置处理', () => {
    const edge = documentOf([['一件事，', 0, 1340], ['每个', 2000, 2500]])
    expect(describeAudioEditBreaths(edge, [{ startMs: 1300, endMs: 1700, peak: 1 }])[0].context).toBe('clause')
    const partly = documentOf([['一件事，', 0, 1000], ['每个', 1750, 2500]], { cuts: [{ id: 'retake', startFrame: 1000, endFrame: 1500, reason: 'manual', enabled: true }] })
    const view = describeAudioEditBreaths(partly, [{ startMs: 1300, endMs: 1700, peak: 1 }])[0]
    expect(view.context).toBe('clause')
    // 剪完听到的空当只剩 1500–1750：删掉保留的 200 后不到 80，留紧挨“每个”的 30 减弱
    const partlyDeleted = applyAudioEditBreathPolicy(partly, [{ startMs: 1300, endMs: 1700, peak: 1 }], 'delete').document
    expect(partlyDeleted.cuts?.find((cut) => cut.id === 'breath:1300')).toMatchObject({ startFrame: 1500, endFrame: 1670 })
    expect(partlyDeleted.gainRegions).toEqual([expect.objectContaining({ id: 'breath:1300', startFrame: 1670, endFrame: 1700 })])
  })
})
