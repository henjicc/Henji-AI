import { describe, expect, it } from 'vitest'
import { spliceAudioEditProject, spliceAudioRanges } from './splice'
import { audioEditProjectSchema } from './schema'
import { emptyAudioEditSource } from './documentContent'
import type { AudioEditProjectDocument } from './types'

const source = { mediaType: 'audio' as const, sourcePath: '/old.wav', audioPath: '/old.wav', durationFrames: 1000, sampleRate: 1000, channels: 1 }
const project = (): AudioEditProjectDocument => ({ id: 'p', name: '录音', source, transcript: [], suggestions: [], referenceScript: '', createdAt: 1, updatedAt: 1, revision: 0 })
const resultSource = (durationFrames: number) => ({ ...source, durationFrames, sourcePath: '/new.wav', audioPath: '/new.wav', ownership: 'managed' as const })
describe('录音素材拼接坐标', () => {
  it('插入点的半开边界、跨切点拆分与后续整体平移，不让旧编辑套到新声音', () => {
    expect(spliceAudioRanges([{ id: 'left', startFrame: 0, endFrame: 200 }, { id: 'cross', startFrame: 100, endFrame: 400 }, { id: 'right', startFrame: 200, endFrame: 800 }], 200, 200, 100)).toEqual([
      { id: 'left', startFrame: 0, endFrame: 200 }, { id: 'cross', startFrame: 100, endFrame: 200 },
      { id: 'cross-splice-1', startFrame: 300, endFrame: 500 }, { id: 'right', startFrame: 300, endFrame: 900 },
    ])
  })
  it('覆盖选区裁剪 cuts、淡变，移除相交修复，保留后方画笔归一化坐标', () => {
    const p = project()
    p.cuts = [{ id: 'c', startFrame: 100, endFrame: 900, enabled: true, reason: 'manual', mode: 'mute' }]
    p.gainRegions = [{ id: 'g', startFrame: 0, endFrame: 800, enabled: true, gainDb: -6, fadeInFrames: 300, fadeOutFrames: 300 }]
    const stroke = { radius: .1, points: [{ x: .5, y: .5 }] }
    p.repairs = [{ id: 'r', startFrame: 100, endFrame: 300, enabled: true, kind: 'spectral_heal', lowHz: 10, highHz: 400, strength: 1 }, { id: 'after', startFrame: 800, endFrame: 900, enabled: true, kind: 'spectral_heal', lowHz: 10, highHz: 400, strength: 1, strokes: [stroke] }]
    const next = spliceAudioEditProject(p, resultSource(800), 200, 500, 100)
    expect(next.cuts?.map(c => [c.startFrame, c.endFrame])).toEqual([[100, 200], [300, 700]])
    expect(next.gainRegions?.map(g => [g.startFrame, g.endFrame, g.fadeInFrames, g.fadeOutFrames])).toEqual([[0, 200, 200, 0], [300, 600, 0, 300]])
    expect(next.repairs).toEqual([{ ...p.repairs[1], startFrame: 600, endFrame: 700 }])
    expect(next.repairs?.[0].strokes).toEqual([stroke])
    expect(audioEditProjectSchema.safeParse(next).success).toBe(true)
    expect(p.source.sourcePath).toBe('/old.wav')
  })
  it('转写、字幕分段、建议与原文基线平移，覆盖词标成待转写', () => {
    const p = project()
    p.transcript = [{ id: 'overlap', text: '旧词', startFrame: 100, endFrame: 250, included: true, locked: false, granularity: 'word' }, { id: 'after', text: '后方', startFrame: 600, endFrame: 800, included: true, locked: false, granularity: 'word', captionBreakAfter: true }]
    p.editBaseline = { kind: 'original', transcript: p.transcript, suggestions: [] }
    const next = spliceAudioEditProject(p, resultSource(900), 200, 400, 100)
    expect(next.transcript[0]).toMatchObject({ text: '（需要重新转写）', startFrame: 200, endFrame: 300, confidence: 0 })
    expect(next.transcript[1]).toMatchObject({ id: 'after', startFrame: 500, endFrame: 700, captionBreakAfter: true })
    expect(next.editBaseline?.transcript).toHaveLength(1)
    expect(next.editBaseline?.transcript[0].startFrame).toBe(500)
  })
  it('空草稿首段可采用设备采样格式，锁定词和无效范围拒绝', () => {
    const p = { ...project(), source: emptyAudioEditSource() }
    expect(spliceAudioEditProject(p, resultSource(300), 0, 0, 300).source).toEqual(resultSource(300))
    expect(() => spliceAudioEditProject(project(), resultSource(300), 1001, 1001, 300)).toThrow('范围')
    const locked = { ...project(), transcript: [{ id: 'w', text: '锁', startFrame: 100, endFrame: 300, included: true, locked: true, granularity: 'word' as const }] }
    expect(() => spliceAudioEditProject(locked, resultSource(1100), 200, 200, 100)).toThrow('锁定')
  })

  it('交接材料跟着线索平移：各种做法的范围一起移，跨过插入位置的线索与条目一并丢掉', () => {
    const word = (id: string, startFrame: number) => ({ id, text: id, startFrame, endFrame: startFrame + 50, included: true, locked: false, granularity: 'word' as const })
    const clue = (id: string, startFrame: number, endFrame: number, blockIds: string[]) => ({ id, kind: 'retake' as const, evidence: 'audio' as const, title: '', detail: '', startFrame, endFrame, blockIds, confidence: 'high' as const, status: 'pending' as const })
    const p: AudioEditProjectDocument = { ...project(), transcript: [word('a', 100), word('b', 250), word('c', 600), word('d', 700), word('e', 800)],
      suggestions: [clue('across', 100, 320, ['a', 'b']), clue('after', 580, 760, ['c'])],
      suggestionHandoff: {
        across: { options: [{ id: 'keep_later', blockIds: ['a', 'b'], startFrame: 100, endFrame: 320 }] },
        after: { reason: 'repeated', audience: 'user', options: [{ id: 'keep_later', blockIds: ['c'], startFrame: 580, endFrame: 660 }, { id: 'keep_earlier', blockIds: ['d'], startFrame: 660, endFrame: 760 }, { id: 'keep_both', blockIds: [], startFrame: 580, endFrame: 660 }] },
        gone: { options: [] },
      } }
    // [200, 300) 换成 400 帧的新录音：后面整体后移 300
    const next = spliceAudioEditProject(p, resultSource(1300), 200, 300, 400)
    expect(next.suggestions.map((item) => [item.id, item.startFrame, item.endFrame])).toEqual([['after', 880, 1060]])
    expect(next.suggestionHandoff).toEqual({ after: { reason: 'repeated', audience: 'user', options: [
      { id: 'keep_later', blockIds: ['c'], startFrame: 880, endFrame: 960 }, { id: 'keep_earlier', blockIds: ['d'], startFrame: 960, endFrame: 1060 }, { id: 'keep_both', blockIds: [], startFrame: 880, endFrame: 960 },
    ] } })
  })
})
