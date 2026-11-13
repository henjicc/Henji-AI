import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createVideoEditTestDocument } from './testFixtures'
import type { VideoEditClip, VideoEditDocument, VideoEditSequence } from './document'
import { makeVideoEditItemClip } from './projectItems'
import { videoEditClipSourceTimeAt } from './clipSpeed'
import { packVideoEditRecordingTake, settleVideoEditRecordingTake, videoEditRecordingLane, videoEditRecordingLaneGaps, videoEditRecordingTarget, type VideoEditRecordingPlacement } from './recordingLane'

const FPS = 30
const US = 1e6 / FPS
const media = (id: string, kind: 'video' | 'audio', recording = false) => ({ id, name: id, path: path.resolve(path.sep, 'media', `${id}.${kind === 'video' ? 'mp4' : 'wav'}`), kind, width: kind === 'video' ? 1920 : 0, height: kind === 'video' ? 1080 : 0, durationSeconds: 7200, ...(recording ? { recordingCursor: {} as never } : {}) })
/**
 * 录屏轨夹具：A1“麦克风”、V1“屏幕”、A2“系统声音”，每块画面链接一段麦克风。录屏画面的素材带指针记录（录屏导入写的来源标记）。
 * `screenTrack` 可把录屏放到别的视频轨上（下面垫背景时）。
 */
function fixture(blocks: number[], screenTrack = 1): VideoEditDocument {
  const document = createVideoEditTestDocument('录屏')
  const sequence = document.sequences[0]
  const track = (index: number, kind: 'video' | 'audio', name: string) => ({ id: `track-${index}`, name, index, kind, locked: false, enabled: true, muted: false, solo: false })
  sequence.tracks = [track(0, 'audio', '麦克风'), track(1, 'video', screenTrack === 1 ? '屏幕' : '视频 1'), track(2, 'audio', '系统声音'), ...(screenTrack === 1 ? [] : [track(screenTrack, 'video', '屏幕')])]
  document.media = [media('screen', 'video', true), media('mic', 'audio'), media('background', 'video'), media('music', 'audio')]
  document.items = ['screen', 'mic', 'background', 'music'].map(id => ({ id: `${id}-item`, name: id, kind: id === 'mic' || id === 'music' ? 'audio' as const : 'video' as const, mediaId: id }))
  let start = 0
  for (const [index, duration] of blocks.entries()) {
    sequence.clips.push(...take(document, `b${index}`, start, duration, { screen: screenTrack, microphone: 0 }, index * 1000))
    start += duration
  }
  return document
}
/** 一段录制：画面加麦克风，源时间从 `sourceSeconds` 起。 */
function take(document: VideoEditDocument, id: string, frame: number, duration: number, tracks: { screen?: number; microphone?: number }, sourceSeconds = 0): VideoEditClip[] {
  const sequence = document.sequences[0]
  const sourceInUs = Math.round(sourceSeconds * 1e6), sourceOutUs = sourceInUs + Math.ceil(duration * US) + 1
  return [
    { ...makeVideoEditItemClip(document, 'screen-item', sequence.id, { frame, track: tracks.screen ?? 1, duration, sourceInUs, sourceOutUs }), id, name: id, linkId: `link-${id}` },
    ...(tracks.microphone === undefined ? [] : [{ ...makeVideoEditItemClip(document, 'mic-item', sequence.id, { frame, track: tracks.microphone, duration, sourceInUs, sourceOutUs }), id: `${id}-mic`, linkId: `link-${id}` }]),
  ]
}
const laneOf = (document: VideoEditDocument) => videoEditRecordingLane({ ...document.sequences[0], items: document.items, media: document.media })
/** 照 `videoEditRecordingTarget` 放下新的一段再落定，等同录制导入的那一步编辑。没有可沿用的麦克风轨时放到 `spareMicrophone`。 */
function record(document: VideoEditDocument, placement: VideoEditRecordingPlacement, duration: number, withMicrophone = true, spareMicrophone?: number): VideoEditDocument {
  const sequence = document.sequences[0]
  const target = videoEditRecordingTarget({ ...sequence, items: document.items, media: document.media }, placement, duration)
  const clips = take(document, 'new', target.frame, duration, { screen: target.tracks.screen, ...(withMicrophone ? { microphone: target.tracks.microphone ?? spareMicrophone } : {}) }, 300)
  const placed = { ...document, sequences: [{ ...sequence, clips: [...sequence.clips, ...clips] }] }
  return settleVideoEditRecordingTake(placed, sequence.id, clips.map(clip => clip.id)).document
}
const spans = (document: VideoEditDocument, track: number) => document.sequences[0].clips.filter(clip => clip.track === track).sort((a, b) => a.start - b.start).map(clip => [clip.start, clip.start + clip.duration])
const foreign = (sequence: VideoEditSequence, document: VideoEditDocument, id: string) => makeVideoEditItemClip(document, `${id}-item`, sequence.id, { frame: 0, track: id === 'background' ? 1 : 0 })

describe('录屏轨按指针落片', () => {
  it('指针在结尾时接在最后，原有的块不动，轨道沿用录屏轨的那几条', () => {
    const document = fixture([100, 150])
    expect(videoEditRecordingTarget({ ...document.sequences[0], items: document.items, media: document.media }, { at: 'frame', frame: 250 })).toMatchObject({ frame: 250, mode: 'append', tracks: { screen: 1, microphone: 0 } })
    const result = record(document, { at: 'end' }, 60)
    expect(spans(result, 1)).toEqual([[0, 100], [100, 250], [250, 310]])
    expect(spans(result, 0)).toEqual([[0, 100], [100, 250], [250, 310]])
    expect(videoEditRecordingLaneGaps(laneOf(result))).toEqual([])
  })

  it('从一段中间覆盖：盖到哪算哪，没盖到的后半截原地不动，源时间接着原来的走；回报盖住了哪段的哪部分', () => {
    const document = fixture([100, 150])
    const original = document.sequences[0].clips.find(clip => clip.id === 'b1')!
    const target = videoEditRecordingTarget({ ...document.sequences[0], items: document.items, media: document.media }, { at: 'frame', frame: 130 }, 50)
    const clips = take(document, 'new', target.frame, 50, { screen: target.tracks.screen, microphone: target.tracks.microphone }, 300)
    const settled = settleVideoEditRecordingTake({ ...document, sequences: [{ ...document.sequences[0], clips: [...document.sequences[0].clips, ...clips] }] }, document.sequences[0].id, clips.map(clip => clip.id))
    expect(settled).toMatchObject({ from: 130, to: 180, covered: [{ name: 'b1', from: 130, to: 180 }] })
    const result = settled.document
    expect(spans(result, 1)).toEqual([[0, 100], [100, 130], [130, 180], [180, 250]])
    expect(spans(result, 0)).toEqual([[0, 100], [100, 130], [130, 180], [180, 250]])
    const right = result.sequences[0].clips.find(clip => clip.track === 1 && clip.start === 180)!
    expect(right.sourceInUs).toBe(videoEditClipSourceTimeAt(original, 180 - original.start, document.sequences[0].frameRate).sourceInUs)
    const lane = laneOf(result)
    expect(videoEditRecordingLaneGaps(lane)).toEqual([])
    // 切开后左右两块各自带着自己那截声音
    expect(lane.blocks.map(block => block.linked.map(clip => [clip.start, clip.duration]))).toEqual([[[0, 100]], [[100, 30]], [[130, 50]], [[180, 70]]])
  })

  it('覆盖跨过多段，被盖住的整段不再使用；覆盖到原来的结尾之后，序列跟着变长', () => {
    const many = record(fixture([100, 100, 100]), { at: 'frame', frame: 50 }, 120)
    expect(spans(many, 1)).toEqual([[0, 50], [50, 170], [170, 200], [200, 300]])
    expect(many.sequences[0].clips.some(clip => clip.id === 'b1')).toBe(false)
    const longer = record(fixture([100, 150]), { at: 'frame', frame: 200 }, 100)
    expect(spans(longer, 1)).toEqual([[0, 100], [100, 200], [200, 300]])
    expect(laneOf(longer).end).toBe(300)
  })

  it('指针停在结尾之后时接在结尾；新的一段没录麦克风时，被盖住那段的麦克风也一起切掉', () => {
    const document = fixture([100])
    expect(videoEditRecordingTarget({ ...document.sequences[0], items: document.items, media: document.media }, { at: 'frame', frame: 400 })).toMatchObject({ frame: 100, mode: 'append' })
    expect(spans(record(fixture([100, 150]), { at: 'frame', frame: 130 }, 50, false), 0)).toEqual([[0, 100], [100, 130], [180, 250]])
  })

  it('V1 垫背景、V2 录屏、上面有文字层与配乐：覆盖只动录屏块自己的画面和链接的声音，其余片段逐字段不变', () => {
    const document = fixture([100, 150], 3)
    const sequence = document.sequences[0]
    sequence.tracks.push({ id: 'track-4', name: '视频 3', index: 4, kind: 'video', locked: false, enabled: true, muted: false, solo: false }, { id: 'track-5', name: '配乐', index: 5, kind: 'audio', locked: false, enabled: true, muted: false, solo: false })
    const background = { ...foreign(sequence, document, 'background'), id: 'background', track: 1, duration: 400 }
    const overlay = { ...foreign(sequence, document, 'background'), id: 'overlay', track: 4, start: 120, duration: 80 }
    const music = { ...foreign(sequence, document, 'music'), id: 'music', track: 5, duration: 400 }
    // 用户自己放在“麦克风”轨上的一段口播，正好落在新一段的范围里
    const voice = { ...foreign(sequence, document, 'music'), id: 'voice', track: 0, start: 260, duration: 40 }
    sequence.clips.push(background, overlay, music, voice)
    expect(laneOf(document)).toMatchObject({ track: 3, end: 250 })
    const target = videoEditRecordingTarget({ ...sequence, items: document.items, media: document.media }, { at: 'frame', frame: 200 }, 100)
    expect(target).toMatchObject({ frame: 200, mode: 'overwrite', tracks: { screen: 3 } })
    expect(target.tracks.microphone).toBeUndefined()
    sequence.tracks.push({ id: 'track-6', name: '麦克风', index: 6, kind: 'audio', locked: false, enabled: true, muted: false, solo: false })
    const result = record(document, { at: 'frame', frame: 200 }, 100, true, 6)
    const after = new Map(result.sequences[0].clips.map(clip => [clip.id, clip]))
    for (const clip of [background, overlay, music, voice]) expect(after.get(clip.id)).toEqual(clip)
    expect(spans(result, 3)).toEqual([[0, 100], [100, 200], [200, 300]])
    expect(spans(result, 0)).toEqual([[0, 100], [100, 200], [260, 300]])
    expect(spans(result, 6)).toEqual([[200, 300]])
  })

  it('认不出唯一一条录屏轨时不猜：不止一条轨放着录屏、或录屏轨上混着别的片段，都拒绝并说明', () => {
    const several = fixture([100])
    several.sequences[0].tracks.push({ id: 'track-3', name: '视频 2', index: 3, kind: 'video', locked: false, enabled: true, muted: false, solo: false })
    several.sequences[0].clips.push(...take(several, 'other', 0, 50, { screen: 3 }))
    expect(laneOf(several).problem).toContain('不止一条')
    expect(() => videoEditRecordingTarget({ ...several.sequences[0], items: several.items, media: several.media }, { at: 'end' })).toThrow('不止一条')
    const mixed = fixture([100])
    mixed.sequences[0].clips.push({ ...foreign(mixed.sequences[0], mixed, 'background'), id: 'background', track: 1, start: 100, duration: 50 })
    expect(laneOf(mixed).problem).toContain('别的片段')
  })

  it('还没有录屏画面时从 0 开始、轨道交给导入去找；不改原文档，撤销回到原文档即恢复', () => {
    const empty = fixture([])
    empty.sequences[0].clips.push({ ...foreign(empty.sequences[0], empty, 'background'), id: 'background', track: 1, duration: 200 })
    expect(videoEditRecordingTarget({ ...empty.sequences[0], items: empty.items, media: empty.media }, { at: 'end' })).toMatchObject({ frame: 0, mode: 'append', tracks: {} })
    const document = fixture([100, 150])
    const before = structuredClone(document)
    record(document, { at: 'frame', frame: 130 }, 50)
    expect(document).toEqual(before)
  })

  it('拼不成一个画面的一次录制：各段在录屏轨上首尾相连，声音跟着自己那段画面走', () => {
    const document = fixture([100])
    const sequence = document.sequences[0]
    const first = take(document, 'p0', 100, 40, { screen: 1, microphone: 0 }, 100), second = take(document, 'p1', 170, 30, { screen: 1, microphone: 0 }, 200)
    const placed = { ...document, sequences: [{ ...sequence, clips: [...sequence.clips, ...first, ...second] }] }
    const packed = packVideoEditRecordingTake(placed, sequence.id, [...first, ...second].map(clip => clip.id))
    expect(spans(packed, 1)).toEqual([[0, 100], [100, 140], [140, 170]])
    expect(spans(packed, 0)).toEqual([[0, 100], [100, 140], [140, 170]])
  })
})
