import { describe, expect, it } from 'vitest'
import type { VideoEditClip, VideoEditSequence } from './document'
import { findVideoEditReplaceTarget, resolveVideoEditDropMode } from './dropPlacement'

function clip(id: string, track: number, patch: Partial<VideoEditClip> = {}): VideoEditClip {
  return { id, itemId: `item-${id}`, name: id, kind: 'video', track, start: 0, duration: 120, sourceInUs: 0,
    sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '', ...patch }
}
const track = (index: number, kind: 'video' | 'audio', id = `t${index}`) => ({ id, name: id, index, kind, locked: false, enabled: true, muted: false, solo: false })
function sequence(clips: VideoEditClip[]): VideoEditSequence {
  return { id: 's', name: '序列', width: 1920, height: 1080, frameRate: { numerator: 30, denominator: 1 }, pixelAspectRatio: { numerator: 1, denominator: 1 }, sampleRate: 48000, channels: 2,
    tracks: [track(0, 'audio'), track(1, 'video'), track(2, 'video'), track(3, 'audio')], clips, annotations: [] }
}
const incoming = [clip('in-v', 1, { start: 500, duration: 200, linkId: 'n' }), clip('in-a', 0, { kind: 'audio', start: 500, duration: 200, linkId: 'n' })]

describe('节目监视器拖放区换算', () => {
  it('覆盖与插入原样交给共享放置编辑', () => {
    const base = sequence([clip('a', 1)])
    expect(resolveVideoEditDropMode(base, incoming, { mode: 'insert', frame: 30, targetTrackIds: [] })).toMatchObject({ frame: 30, mode: 'insert', newTracks: [] })
    expect(resolveVideoEditDropMode(base, incoming, { mode: 'overwrite', frame: 30, targetTrackIds: [] })).toMatchObject({ frame: 30, mode: 'overwrite' })
  })
  it('添加到末尾接在所有轨道最后一个片段之后，空序列从 0 开始', () => {
    expect(resolveVideoEditDropMode(sequence([clip('a', 1, { start: 10, duration: 50 }), clip('b', 3, { kind: 'audio', start: 40, duration: 100 })]), incoming, { mode: 'end', frame: 0, targetTrackIds: [] })).toMatchObject({ frame: 140, mode: 'overwrite' })
    expect(resolveVideoEditDropMode(sequence([]), incoming, { mode: 'end', frame: 99, targetTrackIds: [] }).frame).toBe(0)
  })
  it('放在顶层：画面落到范围内最上层已占用轨道之上的空轨，没有就新建；声音同理', () => {
    const covered = sequence([clip('a', 1), clip('b', 0, { kind: 'audio' })])
    const result = resolveVideoEditDropMode(covered, incoming, { mode: 'top', frame: 30, targetTrackIds: [] })
    expect(result.clips.map(item => item.track)).toEqual([2, 3]); expect(result.newTracks).toEqual([])
    const full = sequence([clip('a', 1), clip('b', 2), clip('c', 3, { kind: 'audio' })])
    const grown = resolveVideoEditDropMode(full, incoming, { mode: 'top', frame: 30, targetTrackIds: [] })
    expect(grown.newTracks.map(item => item.kind)).toEqual(['video', 'audio'])
    expect(grown.clips.map(item => item.track)).toEqual(grown.newTracks.map(item => item.index))
    // 落点范围外的片段不算占用
    expect(resolveVideoEditDropMode(full, incoming, { mode: 'top', frame: 500, targetTrackIds: [] }).clips.map(item => item.track)).toEqual([1, 0])
  })
  it('替换：保持被替换片段的位置与时长，素材从开头填充，沿用画面属性与效果，链接声音落到它的声音轨', () => {
    const target = clip('old', 2, { start: 60, duration: 90, scale: 2, opacity: 0.5, linkId: 'old-link' })
    const base = sequence([clip('below', 1, { start: 0, duration: 300 }), target, clip('old-a', 3, { kind: 'audio', start: 60, duration: 90, linkId: 'old-link' })])
    const result = resolveVideoEditDropMode(base, incoming, { mode: 'replace', frame: 100, targetTrackIds: [] })
    expect(result).toMatchObject({ frame: 60, mode: 'overwrite' })
    expect(result.clips.map(item => [item.track, item.duration, item.sourceInUs])).toEqual([[2, 90, 0], [3, 90, 0]])
    expect(result.clips[0]).toMatchObject({ scale: 2, opacity: 0.5 })
  })
  it('替换优先目标轨道，素材不够长或播放头下没有片段时拒绝', () => {
    const base = sequence([clip('v1', 1, { start: 0, duration: 300 }), clip('v2', 2, { start: 0, duration: 300 })])
    expect(findVideoEditReplaceTarget(base, 10, ['t1'])?.id).toBe('v1')
    expect(findVideoEditReplaceTarget(base, 10, [])?.id).toBe('v2')
    expect(() => resolveVideoEditDropMode(base, incoming, { mode: 'replace', frame: 10, targetTrackIds: [] })).toThrow('短')
    expect(() => resolveVideoEditDropMode(sequence([]), incoming, { mode: 'replace', frame: 10, targetTrackIds: [] })).toThrow('没有可替换')
    // 静帧可拉长到被替换片段的长度
    const still = resolveVideoEditDropMode(base, [clip('img', 1, { kind: 'image', duration: 30 })], { mode: 'replace', frame: 10, targetTrackIds: ['t1'] })
    expect(still.clips[0]).toMatchObject({ track: 1, duration: 300 })
  })
})
