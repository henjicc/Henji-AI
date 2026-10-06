import { describe, expect, it } from 'vitest'
import { createVideoEditDocument, videoEditDocumentSchema, type VideoEditClip } from './document'
import { makeVideoEditItemClip } from './projectItems'
import { applyVideoEditTimelineEdit } from './timelineEdits'
import { applyVideoEditTrim } from './timelineTrims'
import { offsetVideoEditSource, videoEditSourceSeconds } from './time'

/** 30 fps 序列，20 秒素材：V1 上 a[0,60) 源 0 秒、b[60,120) 源 5 秒、c[120,180) 源 10 秒；A1 上 a 的链接声音。 */
function fixture() {
  const document = createVideoEditDocument('修剪')
  document.media = [{ id: 'media', name: '原视频', path: 'D:/clip.mp4', kind: 'video', width: 1920, height: 1080, durationSeconds: 20, hasAudio: true }]
  document.items = [{ id: 'item', name: '原视频', kind: 'video', mediaId: 'media' }]
  const sequence = document.sequences[0]
  const video = sequence.tracks.find(track => track.kind === 'video')!.index; const audio = sequence.tracks.find(track => track.kind === 'audio')!.index
  const base = makeVideoEditItemClip(document, 'item', sequence.id, { frame: 0, track: video })
  const at = (id: string, start: number, sourceFrames: number, track = video, extra: Partial<VideoEditClip> = {}): VideoEditClip => ({ ...base, id, start, duration: 60, track, ...offsetVideoEditSource({ sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 } }, sourceFrames, sequence.frameRate), ...extra })
  sequence.clips = [at('a', 0, 0, video, { linkId: 'pair' }), at('b', 60, 150), at('c', 120, 300), at('a-sound', 0, 0, audio, { kind: 'audio', sourceComponent: 'audio', linkId: 'pair' })]
  sequence.clips[0].sourceComponent = 'video'
  return { document, sequenceId: sequence.id }
}
const sourceFrame = (clip: VideoEditClip | undefined): number => Math.round(videoEditSourceSeconds(clip!) * 30)
function trim(edit: Parameters<typeof applyVideoEditTrim>[2]) {
  const { document, sequenceId } = fixture()
  const result = applyVideoEditTrim(document, sequenceId, edit)
  videoEditDocumentSchema.parse({ ...document, sequences: [result.sequence] })
  return { ...result, clip: (id: string) => result.sequence.clips.find(clip => clip.id === id) }
}

describe('波纹编辑', () => {
  it('拖长出点：片段变长，同步锁定轨道上后面的片段一起后移', () => {
    const result = trim({ mode: 'ripple', clipIds: ['b'], edge: 'out', delta: 10 })
    expect(result.clip('b')).toMatchObject({ start: 60, duration: 70 })
    expect(result.clip('c')).toMatchObject({ start: 130, duration: 60 })
    expect(sourceFrame(result.clip('c'))).toBe(300)
  })
  it('剪掉开头：片段起点不动、源入点后移，后面的片段前移补上空隙', () => {
    const result = trim({ mode: 'ripple', clipIds: ['b'], edge: 'in', delta: 12 })
    expect(result.clip('b')).toMatchObject({ start: 60, duration: 48 })
    expect(sourceFrame(result.clip('b'))).toBe(162)
    expect(result.clip('c')!.start).toBe(108)
  })
  it('素材开头之前没有内容时不能往前补，帧数收紧到 0', () => {
    expect(trim({ mode: 'ripple', clipIds: ['a', 'a-sound'], edge: 'in', delta: -20 }).delta).toBe(0)
  })
})

describe('滚动编辑', () => {
  it('移动 a 与 b 之间的编辑点：a 出点与 b 入点一起变，总长不变', () => {
    const result = trim({ mode: 'roll', clipIds: ['a'], edge: 'out', delta: 10 })
    expect(result.clip('a')).toMatchObject({ start: 0, duration: 70 })
    expect(result.clip('b')).toMatchObject({ start: 70, duration: 50 })
    expect(sourceFrame(result.clip('b'))).toBe(160)
    expect(result.clip('c')!.start).toBe(120)
  })
  it('超过右段长度时收紧到右段只剩一帧', () => {
    expect(trim({ mode: 'roll', clipIds: ['b'], edge: 'out', delta: 500 }).delta).toBe(59)
  })
  it('一侧是空白时只修剪到空白边缘', () => {
    // 声音轨上 a-sound 后面是空白：出点只能延长到素材结尾（20 秒）
    expect(trim({ mode: 'roll', clipIds: ['a-sound'], edge: 'out', delta: 10_000 }).delta).toBe(540)
  })
})

describe('外滑与内滑', () => {
  it('外滑只改源入点，位置与长度不变；超出素材时收紧', () => {
    const result = trim({ mode: 'slip', clipIds: ['b'], delta: 15 })
    expect(result.clip('b')).toMatchObject({ start: 60, duration: 60 })
    expect(sourceFrame(result.clip('b'))).toBe(165)
    expect(trim({ mode: 'slip', clipIds: ['b'], delta: -1000 }).delta).toBe(-150)
  })
  it('内滑移动片段，前一段出点与后一段入点让位，内容不变', () => {
    const result = trim({ mode: 'slide', clipIds: ['b'], delta: 10 })
    expect(result.clip('b')).toMatchObject({ start: 70, duration: 60 })
    expect(sourceFrame(result.clip('b'))).toBe(150)
    expect(result.clip('a')).toMatchObject({ duration: 70 })
    expect(result.clip('c')).toMatchObject({ start: 130, duration: 50 })
    expect(sourceFrame(result.clip('c'))).toBe(310)
  })
})

it('时间线编辑入口按链接展开：修剪画面同时修剪链接的声音', () => {
  const { document, sequenceId } = fixture()
  const sequence = applyVideoEditTimelineEdit(document, sequenceId, { kind: 'trim', mode: 'slip', clipIds: ['a'], delta: 30 })
  expect(sequence.clips.filter(clip => clip.linkId === 'pair').map(sourceFrame)).toEqual([30, 30])
})
