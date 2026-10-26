// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { adjustAudioEditRangeMode, applyAudioEditSuggestion, cleanAudioEditFillers, editAudioEditRange, setAudioEditBlocks } from './edits'
import { buildProjectAudioEditTimeline, editedDurationFrames } from './timeline'
import { buildAudioEditXml, compileAudioEditXmlTimeline } from './xml'
import type { AudioEditProjectDocument } from './types'

function project(): AudioEditProjectDocument {
  return { id: 'p', name: '口播 & 测试', source: { mediaType: 'audio', sourcePath: 'D:/原片.wav', audioPath: 'D:/原片.wav', durationFrames: 4000, sampleRate: 1000, channels: 2 }, referenceScript: '', createdAt: 0, updatedAt: 0, revision: 1,
    transcript: [{ id: 'a', text: '嗯', startFrame: 0, endFrame: 1000, included: true, locked: false, granularity: 'word' }, { id: 'b', text: '继续', startFrame: 3000, endFrame: 4000, included: true, locked: false, granularity: 'word' }],
    suggestions: [{ id: 'silence', kind: 'long_silence', evidence: 'audio', title: '停顿', detail: '', startFrame: 1000, endFrame: 3000, blockIds: [], confidence: 'high', status: 'pending' }] }
}

describe('audio edit shared decisions and interchange', () => {
  it('mutes without shortening, subtracts locked speech and restores partial intervals', () => {
    const original = project()
    original.transcript[0].locked = true
    const muted = editAudioEditRange(original, { startFrame: 500, endFrame: 2500 }, 'mute')
    expect(muted.cuts).toEqual([expect.objectContaining({ startFrame: 1000, endFrame: 2500, mode: 'mute' })])
    expect(editedDurationFrames(buildProjectAudioEditTimeline(muted))).toBe(4000)
    expect(buildProjectAudioEditTimeline(muted).filter((span) => span.muted)).toEqual([{ sourceStartFrame: 1000, sourceEndFrame: 2500, outputStartFrame: 1000, outputEndFrame: 2500, muted: true }])
    expect(editAudioEditRange(muted, { startFrame: 500, endFrame: 2500 }, 'mute')).toBe(muted)
    const restored = editAudioEditRange(muted, { startFrame: 1500, endFrame: 2000 }, 'restore')
    expect(restored.cuts?.map((cut) => [cut.startFrame, cut.endFrame])).toEqual([[1000, 1500], [2000, 2500]])
    expect(new Set(restored.cuts?.map((cut) => cut.id)).size).toBe(2)
    const deleted = editAudioEditRange(restored, { startFrame: 1800, endFrame: 2300 }, 'delete')
    expect(editedDurationFrames(buildProjectAudioEditTimeline(deleted))).toBe(3500)
  })
  it('拖动区间边缘只增减这一种处理：静音与删除各管各的，往哪拉就把哪种叠上去', () => {
    const base = editAudioEditRange(editAudioEditRange(project(), { startFrame: 1000, endFrame: 1600 }, 'mute'), { startFrame: 1600, endFrame: 2400 }, 'delete')
    // 删除的左边缘往左拉过静音：删除扩上去，静音还在
    const grown = adjustAudioEditRangeMode(base, { startFrame: 1300, endFrame: 1600 }, 'delete', 'add')
    expect(buildProjectAudioEditTimeline(grown).filter((span) => span.muted).map((span) => [span.sourceStartFrame, span.sourceEndFrame])).toEqual([[1000, 1300]])
    expect(grown.cuts?.filter((cut) => cut.mode === 'mute')).toHaveLength(1)
    // 删除的右边缘往回收：只撤删除，静音不动
    const shrunk = adjustAudioEditRangeMode(base, { startFrame: 2000, endFrame: 2400 }, 'delete', 'remove')
    expect(editedDurationFrames(buildProjectAudioEditTimeline(shrunk))).toBe(3600)
    expect(shrunk.cuts?.find((cut) => cut.mode === 'mute')).toMatchObject({ startFrame: 1000, endFrame: 1600 })
    // 静音的一边拉到另一边：整段静音取消，删除不动
    const cancelled = adjustAudioEditRangeMode(base, { startFrame: 1000, endFrame: 1600 }, 'mute', 'remove')
    expect(buildProjectAudioEditTimeline(cancelled).some((span) => span.muted)).toBe(false)
    expect(editedDurationFrames(buildProjectAudioEditTimeline(cancelled))).toBe(3200)
    // 删除区里整段的词随删除一起恢复
    const words = setAudioEditBlocks(project(), ['b'], false)
    expect(adjustAudioEditRangeMode(words, { startFrame: 2900, endFrame: 4000 }, 'delete', 'remove').transcript.find((block) => block.id === 'b')?.included).toBe(true)
    expect(adjustAudioEditRangeMode(words, { startFrame: 2900, endFrame: 4000 }, 'mute', 'remove').transcript.find((block) => block.id === 'b')?.included).toBe(false)
    // 只拖回一个已删词的一部分：边缘停在松手的位置，没恢复的那部分仍删除
    const partly = adjustAudioEditRangeMode(words, { startFrame: 3400, endFrame: 4000 }, 'delete', 'remove')
    expect(partly.transcript.find((block) => block.id === 'b')?.included).toBe(true)
    expect(buildProjectAudioEditTimeline(partly).map((span) => [span.sourceStartFrame, span.sourceEndFrame])).toEqual([[0, 3000], [3400, 4000]])
  })
  it('手动改过的自动剪辑归用户：改成手动剪辑并留停用标记，之后重跑不覆盖', () => {
    const auto = { ...project(), cuts: [
      { id: 'gap:1000', startFrame: 1100, endFrame: 1300, reason: 'silence' as const, enabled: true, mode: 'mute' as const },
      { id: 'gap:1000:1', startFrame: 1300, endFrame: 2700, reason: 'silence' as const, enabled: true },
      { id: 'breath:2800', startFrame: 2800, endFrame: 2900, reason: 'silence' as const, enabled: true },
    ] }
    const trimmed = adjustAudioEditRangeMode(auto, { startFrame: 1100, endFrame: 1200 }, 'mute', 'remove')
    expect(trimmed.cuts?.filter((cut) => cut.enabled).map((cut) => [cut.id, cut.startFrame, cut.endFrame])).toEqual([
      ['manual:gap:1000', 1200, 1300], ['manual:gap:1000:1', 1300, 2700], ['breath:2800', 2800, 2900]])
    expect(trimmed.cuts?.find((cut) => cut.id === 'gap:1000')).toMatchObject({ enabled: false, startFrame: 1100, endFrame: 2700 })
    // 没碰到的自动剪辑照旧
    expect(editAudioEditRange(trimmed, { startFrame: 3200, endFrame: 3300 }, 'mute').cuts?.some((cut) => cut.id === 'breath:2800' && cut.enabled)).toBe(true)
  })
  it('XML mutes only audio tracks and preserves linked video and continuous duration', () => {
    const original = project()
    original.source.mediaType = 'video'
    original.source.video = { frameRate: { numerator: 25, denominator: 1 }, width: 1920, height: 1080, startSeconds: 0, durationSeconds: 4, variableFrameRate: false }
    const muted = editAudioEditRange(original, { startFrame: 1001, endFrame: 1999 }, 'mute')
    const timeline = compileAudioEditXmlTimeline(muted)
    expect(timeline.duration).toBe(100)
    expect(timeline.clips.filter((clip) => clip.muted)).toEqual([{ sourceIn: 26, sourceOut: 49, start: 26, end: 49, muted: true }])
    const xml = new DOMParser().parseFromString(buildAudioEditXml(muted, timeline, 'file:///D:/source.mov'), 'application/xml')
    expect(xml.querySelector('parsererror')).toBeNull()
    expect([...xml.querySelectorAll('sequence > media > video > track > clipitem > enabled')].every((node) => node.textContent === 'TRUE')).toBe(true)
    expect([...xml.querySelectorAll('sequence > media > audio > track > clipitem > enabled')].filter((node) => node.textContent === 'FALSE')).toHaveLength(2)
  })
  it('actually shortens silence once and preserves locked regions in every timeline', () => {
    const first = applyAudioEditSuggestion(project(), 'silence')
    expect(editedDurationFrames(buildProjectAudioEditTimeline(first))).toBe(2350)
    expect(applyAudioEditSuggestion(first, 'silence')).toBe(first)
    first.transcript[0].locked = true
    first.transcript[0].included = false
    expect(buildProjectAudioEditTimeline(first)[0].sourceStartFrame).toBe(0)
  })
  it('does not claim a protected suggestion applied or cut segment-level fillers', () => {
    const value = project()
    value.transcript.push({ ...value.transcript[0], id: 'locked', startFrame: 1500, endFrame: 2000, locked: true })
    expect(applyAudioEditSuggestion(value, 'silence')).toBe(value)
    value.transcript[0].granularity = 'segment'
    expect(cleanAudioEditFillers(value, ['嗯'])).toBe(value)
  })
  it('rounds outward once, produces consecutive linked clips and escapes XML', () => {
    const value = applyAudioEditSuggestion(project(), 'silence')
    const timeline = compileAudioEditXmlTimeline(value)
    expect(timeline.clips).toEqual([{ sourceIn: 0, sourceOut: 30, start: 0, end: 30 }, { sourceIn: 70, sourceOut: 100, start: 30, end: 60 }])
    const xml = buildAudioEditXml(value, timeline, 'file:///D:/%E5%8E%9F%E7%89%87.wav')
    expect(xml).toContain('<xmeml version="5">')
    expect(xml).toContain('口播 &amp; 测试')
    expect(xml).toContain('<linkclipref>clip-0-2</linkclipref>')
    expect(xml).not.toContain('<video>')
  })
  it('keeps NTSC exact, accounts for stream offsets and rejects unstable video', () => {
    const value = project()
    value.source.mediaType = 'video'
    value.source.audioStartSeconds = 0.2
    value.source.video = { frameRate: { numerator: 30000, denominator: 1001 }, width: 1920, height: 1080, startSeconds: 0, durationSeconds: 5, variableFrameRate: false }
    const timeline = compileAudioEditXmlTimeline(value)
    expect(timeline.ntsc).toBe(true)
    expect(timeline.timebase).toBe(30)
    expect(timeline.clips[0].sourceIn).toBe(5)
    expect(buildAudioEditXml(value, timeline, 'file:///D:/source.mp4')).toContain('<linkclipref>clip-0-0</linkclipref>')
    value.source.video.variableFrameRate = true
    expect(() => compileAudioEditXmlTimeline(value)).toThrow('帧率')
  })
})

for (const sampleRate of [44100, 48000]) for (const rate of [{ numerator: 25, denominator: 1 }, { numerator: 30, denominator: 1 }, { numerator: 30000, denominator: 1001 }]) {
  it(`preserves outward cuts and contiguous output at ${sampleRate}Hz / ${rate.numerator}:${rate.denominator}`, () => {
    const value = project()
    value.source.sampleRate = sampleRate
    value.source.durationFrames = sampleRate * 3600
    value.transcript = []
    value.cuts = Array.from({ length: 1000 }, (_, index) => ({ id: String(index), reason: 'manual' as const, enabled: true, startFrame: (index * 3 + 1) * sampleRate + 17, endFrame: (index * 3 + 2) * sampleRate - 31 }))
    const timeline = compileAudioEditXmlTimeline(value, rate)
    const fps = rate.numerator / rate.denominator
    expect(timeline.clips[0].sourceIn).toBe(0)
    for (let index = 1; index < timeline.clips.length; index += 1) expect(timeline.clips[index].start).toBe(timeline.clips[index - 1].end)
    for (const cut of value.cuts) {
      const before = timeline.clips.find((clip) => clip.sourceOut / fps * sampleRate >= cut.startFrame && clip.sourceOut / fps * sampleRate < cut.endFrame)
      expect(before).toBeDefined()
      expect(before!.sourceOut / fps * sampleRate - cut.startFrame).toBeLessThan(sampleRate / fps + 1)
    }
    const xml = new DOMParser().parseFromString(buildAudioEditXml(value, timeline, 'file:///D:/%E4%B8%AD%20%26%23.wav'), 'application/xml')
    expect(xml.querySelector('parsererror')).toBeNull()
    expect(xml.querySelectorAll('file pathurl')).toHaveLength(1)
    expect(xml.querySelectorAll('clipitem')).toHaveLength(timeline.clips.length * 2)
  })
}

describe('重念剪辑', () => {
  it('重念删除连同其间停顿一起剪掉，在文字里恢复任一词时停顿也恢复', () => {
    // 第一遍 [500,1500)，停顿 [1500,2200)，第二遍 [2200,3200)；删除范围从第一遍前的停顿到第二遍开头前留出气口
    const original: AudioEditProjectDocument = { ...project(), transcript: [
      { id: 'r1', text: '所以', startFrame: 500, endFrame: 900, included: true, locked: false, granularity: 'word' },
      { id: 'r2', text: '综合', startFrame: 1000, endFrame: 1500, included: true, locked: false, granularity: 'word' },
      { id: 't1', text: '所以', startFrame: 2200, endFrame: 2600, included: true, locked: false, granularity: 'word' },
      { id: 't2', text: '综合来看', startFrame: 2600, endFrame: 3200, included: true, locked: false, granularity: 'word' },
    ], suggestions: [{ id: 'retake:r1:r2', kind: 'retake', evidence: 'audio', title: '重念', detail: '', startFrame: 400, endFrame: 2080, blockIds: ['r1', 'r2'], confidence: 'high', status: 'pending' }] }
    const applied = applyAudioEditSuggestion(original, 'retake:r1:r2')
    expect(applied.transcript.filter((block) => !block.included).map((block) => block.id)).toEqual(['r1', 'r2'])
    expect(applied.cuts?.map((cut) => [cut.startFrame, cut.endFrame])).toEqual([[400, 500], [900, 1000], [1500, 2080]])
    expect(editedDurationFrames(buildProjectAudioEditTimeline(applied))).toBe(4000 - 1680)
    expect(applied.suggestions[0].status).toBe('applied')
    const restored = setAudioEditBlocks(applied, ['r2'], true)
    expect(restored.cuts).toEqual([])
    expect(editedDurationFrames(buildProjectAudioEditTimeline(restored))).toBe(4000 - 400)
    // 删除普通词不影响重念剪掉的停顿；锁定内容不被剪掉
    expect(setAudioEditBlocks(applied, ['t2'], false).cuts).toEqual(applied.cuts)
    const locked = { ...original, transcript: original.transcript.map((block) => block.id === 't1' ? { ...block, locked: true, startFrame: 2000 } : block) }
    expect(applyAudioEditSuggestion(locked, 'retake:r1:r2').cuts?.map((cut) => [cut.startFrame, cut.endFrame])).toEqual([[400, 500], [900, 1000], [1500, 2000]])
  })
})
