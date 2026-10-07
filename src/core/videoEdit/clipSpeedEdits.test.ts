import { createVideoEditTestDocument as createVideoEditDocument } from './testFixtures'
import { describe, expect, it } from 'vitest'
import { splitVideoEditClip, videoEditDocumentSchema, type VideoEditClip } from './document'
import { makeVideoEditItemClip } from './projectItems'
import { applyVideoEditTimelineEdit } from './timelineEdits'
import { applyVideoEditTrim } from './timelineTrims'
import { offsetVideoEditSource, videoEditSourceSeconds } from './time'
import { videoEditClipSourceRange } from './clipSpeed'

/** 30 fps 序列，20 秒素材：V1 上 a[0,60) 源 0 秒、b[60,120) 源 5 秒、c[150,210) 源 10 秒；A1 上 a 的链接声音。 */
function fixture() {
  const document = createVideoEditDocument('速度')
  document.media = [{ id: 'media', name: '原视频', path: 'D:/clip.mp4', kind: 'video', width: 1920, height: 1080, durationSeconds: 20, hasAudio: true }]
  document.items = [{ id: 'item', name: '原视频', kind: 'video', mediaId: 'media' }, { id: 'title', name: '标题', kind: 'text' }]
  const sequence = document.sequences[0]
  const video = sequence.tracks.find(track => track.kind === 'video')!.index; const audio = sequence.tracks.find(track => track.kind === 'audio')!.index
  const base = makeVideoEditItemClip(document, 'item', sequence.id, { frame: 0, track: video })
  const at = (id: string, start: number, sourceFrames: number, track = video, extra: Partial<VideoEditClip> = {}): VideoEditClip => ({ ...base, id, start, duration: 60, track, ...offsetVideoEditSource({ sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 } }, sourceFrames, sequence.frameRate), ...extra })
  sequence.clips = [at('a', 0, 0, video, { linkId: 'pair', sourceComponent: 'video' }), at('b', 60, 150), at('c', 150, 300), at('a-sound', 0, 0, audio, { kind: 'audio', sourceComponent: 'audio', linkId: 'pair' })]
  return { document, sequenceId: sequence.id }
}
function edit(change: Parameters<typeof applyVideoEditTimelineEdit>[2]) {
  const { document, sequenceId } = fixture()
  const sequence = applyVideoEditTimelineEdit(document, sequenceId, change)
  videoEditDocumentSchema.parse({ ...document, sequences: [sequence] })
  return { sequence, clip: (id: string) => sequence.clips.find(clip => clip.id === id)! }
}

describe('速度/持续时间（Ctrl+R）', () => {
  it('200%：时长减半，开头内容不变，链接的声音一起变', () => {
    const result = edit({ kind: 'speed', clipIds: ['a'], change: { speed: { numerator: 2, denominator: 1 } } })
    expect(result.clip('a')).toMatchObject({ start: 0, duration: 30, speed: { numerator: 2, denominator: 1 } })
    expect(result.clip('a-sound')).toMatchObject({ duration: 30, speed: { numerator: 2, denominator: 1 } })
    expect(videoEditSourceSeconds(result.clip('a'))).toBe(0)
    expect(result.clip('b').start).toBe(60)
  })
  it('50% 不波纹：变长只用到后面片段之前的空白；波纹：后面的片段整体后移', () => {
    const plain = edit({ kind: 'speed', clipIds: ['b'], linked: false, change: { speed: { numerator: 1, denominator: 2 } } })
    expect(plain.clip('b')).toMatchObject({ start: 60, duration: 90 }); expect(plain.clip('c').start).toBe(150)
    const ripple = edit({ kind: 'speed', clipIds: ['b'], linked: false, change: { speed: { numerator: 1, denominator: 2 }, ripple: true } })
    expect(ripple.clip('b')).toMatchObject({ start: 60, duration: 120 }); expect(ripple.clip('c').start).toBe(210)
    // 加速 + 波纹：后面的片段前移补上空出来的长度。
    const faster = edit({ kind: 'speed', clipIds: ['b'], linked: false, change: { speed: { numerator: 3, denominator: 1 }, ripple: true } })
    expect(faster.clip('b').duration).toBe(20); expect(faster.clip('c').start).toBe(110)
  })
  it('持续时间：源内容不变，速度随时长变化；倒放：源范围不变、源入点换到另一端', () => {
    const result = edit({ kind: 'speed', clipIds: ['b'], linked: false, change: { duration: 30, reverse: true, preservePitch: true } })
    const b = result.clip('b')
    expect(b).toMatchObject({ duration: 30, speed: { numerator: 2, denominator: 1 }, reverse: true, preservePitch: true })
    expect(videoEditClipSourceRange(b, 30)).toEqual({ from: 5, to: 7 })
  })
  it('文字等没有源时间的片段不能改速度，说明原因', () => {
    const { document, sequenceId } = fixture()
    const title = { ...document.sequences[0].clips[1], id: 't', itemId: 'title', kind: 'text' as const, start: 300, sourceInUs: 0 }
    document.sequences[0].clips.push(title)
    expect(() => applyVideoEditTimelineEdit(document, sequenceId, { kind: 'speed', clipIds: ['t'], change: { speed: { numerator: 2, denominator: 1 } } })).toThrow('只有视频、音频与代码素材片段')
  })
})

describe('比率拉伸工具（R）', () => {
  it('拖出点：长度变、源范围不变，碰到后面的片段收紧', () => {
    const result = edit({ kind: 'stretch', clipIds: ['b'], linked: false, edge: 'out', delta: 60 })
    const b = result.clip('b')
    expect(b).toMatchObject({ start: 60, duration: 90, speed: { numerator: 2, denominator: 3 } })
    expect(videoEditClipSourceRange(b, 30)).toEqual(videoEditClipSourceRange(fixture().document.sequences[0].clips[1], 30))
  })
  it('拖入点：出点不动、起点左移，碰到前面的片段收紧', () => {
    const { document, sequenceId } = fixture()
    document.sequences[0].clips[1].start = 90
    const sequence = applyVideoEditTimelineEdit(document, sequenceId, { kind: 'stretch', clipIds: ['b'], linked: false, edge: 'in', delta: -60 })
    expect(sequence.clips.find(clip => clip.id === 'b')).toMatchObject({ start: 60, duration: 90, speed: { numerator: 2, denominator: 3 } })
  })
})

describe('变速片段的修剪与拆分沿播放方向', () => {
  it('倒放片段剪掉开头：源入点后退（倒放开头是素材里较晚的内容）；拆分右段从拆分处继续倒放', () => {
    const { document, sequenceId } = fixture()
    const reversed = applyVideoEditTimelineEdit(document, sequenceId, { kind: 'speed', clipIds: ['b'], linked: false, change: { reverse: true } })
    const next = { ...document, sequences: [reversed] }
    const trimmed = applyVideoEditTrim(next, sequenceId, { mode: 'ripple', clipIds: ['b'], edge: 'in', delta: 15 })
    const b = trimmed.sequence.clips.find(clip => clip.id === 'b')!
    expect(videoEditClipSourceRange(b, 30)).toEqual({ from: 5, to: 6.5 })
    const split = splitVideoEditClip(reversed, 'b', 90)
    const parts = split.clips.filter(clip => clip.itemId === 'item' && clip.track === b.track && clip.start >= 60 && clip.start < 120)
    expect(parts.map(clip => videoEditClipSourceRange(clip, 30))).toEqual([{ from: 6, to: 7 }, { from: 5, to: 6 }])
  })
})
