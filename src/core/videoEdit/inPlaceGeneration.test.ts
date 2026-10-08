import { createVideoEditTestDocument as createVideoEditDocument } from './testFixtures'
import { describe, expect, it } from 'vitest'
import { videoEditDocumentSchema, type VideoEditClip, type VideoEditDocument } from './document'
import { makeVideoEditItemClip, placeVideoEditItem } from './projectItems'
import { landVideoEditInPlaceResult, planVideoEditInPlaceGeneration, switchVideoEditClipTake, videoEditTrackGap } from './inPlaceGeneration'
import { videoEditSourceSeconds } from './time'

/** 30 fps：V1 上 a[0,60)、b[150,210)（中间 3 秒空隙）；A1 空。另有一段 4 秒的生成视频与 2 秒的生成声音素材。 */
function fixture() {
  const document = createVideoEditDocument('原地生成')
  document.media = [
    { id: 'media', name: '原视频', path: 'D:/clip.mp4', kind: 'video', width: 1920, height: 1080, durationSeconds: 20 },
    { id: 'gen', name: '生成镜头', path: 'D:/gen.mp4', kind: 'video', width: 1920, height: 1080, durationSeconds: 4 },
    { id: 'voice', name: '配音', path: 'D:/voice.wav', kind: 'audio', width: 0, height: 0, durationSeconds: 2 },
  ]
  document.items = [{ id: 'item', name: '原视频', kind: 'video', mediaId: 'media' }, { id: 'gen-item', name: '生成镜头', kind: 'video', mediaId: 'gen' }, { id: 'voice-item', name: '配音', kind: 'audio', mediaId: 'voice' }]
  const sequence = document.sequences[0]
  const video = sequence.tracks.find(track => track.kind === 'video')!.index
  const audio = sequence.tracks.find(track => track.kind === 'audio')!.index
  const clip = (id: string, start: number, extra: Partial<VideoEditClip> = {}): VideoEditClip => ({ ...makeVideoEditItemClip(document, 'item', sequence.id, { frame: start, track: video, duration: 60 }), id, name: id, ...extra })
  sequence.clips = [clip('a', 0), clip('b', 150, { sourceInUs: 5_000_000, x: 0.25, opacity: 0.5 })]
  return { document, sequenceId: sequence.id, video, audio }
}
const sequenceOf = (document: VideoEditDocument) => document.sequences[0]
const valid = (document: VideoEditDocument): VideoEditDocument => videoEditDocumentSchema.parse(document)

describe('原地生成规划', () => {
  it('同一规划器输出范围、占用、锁定与版本选择事实，不靠应用层再推算', () => {
    const { document, sequenceId, video } = fixture()
    const failure = (action: () => unknown) => { try { action(); throw new Error('应拒绝') } catch (error) { return error } }
    expect(failure(() => planVideoEditInPlaceGeneration(document, sequenceId, { action: 'generate_shot', frame: -1 }))).toMatchObject({ facts: { reason: 'range', minFrame: 0, maxFrame: 2591999 } })
    expect(failure(() => planVideoEditInPlaceGeneration(document, sequenceId, { action: 'generate_shot', frame: 1, trackIndex: video }))).toMatchObject({ facts: { reason: 'slot_occupied', occupiedClips: [{ clipId: 'a', startFrame: 0, endFrame: 60 }] } })
    expect(failure(() => switchVideoEditClipTake(document, sequenceId, 'a', 3))).toMatchObject({ facts: { reason: 'take_missing', availableTakeIndexes: [] } })
    const track = document.sequences[0].tracks.find(track => track.index === video)!
    track.locked = true
    expect(failure(() => planVideoEditInPlaceGeneration(document, sequenceId, { action: 'generate_shot', frame: 60, trackIndex: video }))).toMatchObject({ facts: { reason: 'track_locked', trackId: track.id } })
  })
  it('空隙：生成镜头填满空隙，带上前一镜头尾帧与后一镜头首帧', () => {
    const { document, sequenceId, video } = fixture()
    expect(videoEditTrackGap(sequenceOf(document), video, 100)).toEqual({ from: 60, to: 150 })
    const plan = planVideoEditInPlaceGeneration(document, sequenceId, { action: 'generate_shot', frame: 60, trackIndex: video })
    expect(plan).toMatchObject({ mediaType: 'video', frame: 60, duration: 90, trackIndex: video, placement: 'add', width: 1920, height: 1080 })
    expect(plan.references.map(value => [value.role, value.clipId])).toEqual([['previous_tail', 'a'], ['next_head', 'b']])
    // 尾帧落在最后一帧中间；首帧落在 b 的源入点后半帧
    expect(plan.references[0].sourceTimeUs).toBe(Math.round(59.5 / 30 * 1e6))
    expect(plan.references[1].sourceTimeUs).toBe(Math.round((5 + 0.5 / 30) * 1e6))
  })
  it('落点在片段上时拒绝；后面没有片段时默认 5 秒', () => {
    const { document, sequenceId, video } = fixture()
    expect(() => planVideoEditInPlaceGeneration(document, sequenceId, { action: 'generate_shot', frame: 30, trackIndex: video })).toThrow('落点已有片段')
    expect(planVideoEditInPlaceGeneration(document, sequenceId, { action: 'generate_shot', frame: 300, trackIndex: video })).toMatchObject({ duration: 150, fill: false })
    expect(planVideoEditInPlaceGeneration(document, sequenceId, { action: 'generate_shot', frame: 60, trackIndex: video })).toMatchObject({ duration: 90, fill: true })
  })
  it('替换与延长：参考被替换镜头首帧、被延长镜头尾帧；延长默认插入', () => {
    const { document, sequenceId } = fixture()
    expect(planVideoEditInPlaceGeneration(document, sequenceId, { action: 'replace_shot', clipId: 'b' })).toMatchObject({ frame: 150, duration: 60, placement: 'replace', references: [{ role: 'replaced_head', clipId: 'b' }] })
    expect(planVideoEditInPlaceGeneration(document, sequenceId, { action: 'extend_shot', clipId: 'a', duration: 45 })).toMatchObject({ frame: 60, duration: 45, placement: 'insert', references: [{ role: 'extended_tail', clipId: 'a' }] })
    expect(() => planVideoEditInPlaceGeneration(document, sequenceId, { action: 'generate_audio', clipId: 'a' })).toThrow('声音片段')
  })
  it('配音：自动选空着的音频轨，没有参考画面', () => {
    const { document, sequenceId, audio } = fixture()
    expect(planVideoEditInPlaceGeneration(document, sequenceId, { action: 'generate_audio', frame: 90, duration: 60 })).toMatchObject({ mediaType: 'audio', trackIndex: audio, placement: 'add', references: [] })
  })
})

describe('原地生成落位', () => {
  it('带声音结果拆成链接音画，A1 被占时建空轨且保护已有声音', () => {
    const { document, sequenceId, video, audio } = fixture()
    document.media.find(value => value.id === 'gen')!.hasAudio = true
    const occupied = makeVideoEditItemClip(document, 'voice-item', sequenceId, { frame: 60, track: audio, duration: 60 })
    sequenceOf(document).clips.push(occupied)
    const landed = landVideoEditInPlaceResult(document, planVideoEditInPlaceGeneration(document, sequenceId, { action: 'generate_shot', frame: 60, trackIndex: video }), 'gen-item')
    const result = sequenceOf(valid(landed.document))
    const picture = result.clips.find(value => value.id === landed.clipId)!
    const sound = result.clips.find(value => value.kind === 'audio' && value.linkId === picture.linkId)!
    expect(picture).toMatchObject({ sourceComponent: 'video', track: video, start: 60, duration: 90 })
    expect(sound).toMatchObject({ sourceComponent: 'audio', itemId: 'gen-item', start: 60, duration: 90 })
    expect(picture.linkId).toBeTruthy(); expect(sound.track).not.toBe(audio)
    expect(result.clips.find(value => value.id === occupied.id)).toEqual(occupied)
    expect(result.tracks.find(value => value.index === sound.track)?.kind).toBe('audio')
  })
  it('空闲音频轨直接复用；延长与插入也保持音画链接', () => {
    const { document, sequenceId, video, audio } = fixture()
    document.media.find(value => value.id === 'gen')!.hasAudio = true
    for (const intent of [{ action: 'generate_shot' as const, frame: 60, trackIndex: video }, { action: 'extend_shot' as const, clipId: 'a', duration: 30 }, { action: 'extend_shot' as const, clipId: 'a', duration: 30, mode: 'overwrite' as const }]) {
      const landed = landVideoEditInPlaceResult(document, planVideoEditInPlaceGeneration(document, sequenceId, intent), 'gen-item')
      const result = sequenceOf(valid(landed.document)); const picture = result.clips.find(value => value.id === landed.clipId)!
      expect(result.clips.find(value => value.kind === 'audio' && value.linkId === picture.linkId)).toMatchObject({ track: audio, start: picture.start, duration: picture.duration })
      expect(result.tracks).toHaveLength(sequenceOf(document).tracks.length)
    }
  })
  it('替换连同链接声音更新，切回在移动后恢复原声音源范围/音量；静音结果移除原声音', () => {
    const { document, sequenceId, video, audio } = fixture()
    document.media[0].hasAudio = true; document.media[1].hasAudio = true
    const original = placeVideoEditItem(document, 'item', sequenceId, { frame: 150, track: video, audioTrack: audio, duration: 60, sourceInUs: 5_000_000 }).clips
    original[0].id = 'b'; original[0].x = .25; original[1].volume = .4
    sequenceOf(document).clips = original
    const plan = planVideoEditInPlaceGeneration(document, sequenceId, { action: 'replace_shot', clipId: 'b' })
    const replaced = valid(landVideoEditInPlaceResult(document, plan, 'gen-item').document)
    expect(sequenceOf(replaced).clips.filter(value => value.kind === 'audio')).toEqual([expect.objectContaining({ itemId: 'gen-item', sourceInUs: 0 })])
    sequenceOf(replaced).clips.forEach(value => { value.start += 30 })
    const restored = valid(switchVideoEditClipTake(replaced, sequenceId, 'b', 0))
    const picture = sequenceOf(restored).clips.find(value => value.id === 'b')!
    expect(picture).toMatchObject({ itemId: 'item', start: 180, x: .25 })
    expect(sequenceOf(restored).clips.find(value => value.kind === 'audio')).toMatchObject({ itemId: 'item', start: 180, sourceInUs: 5_000_000, volume: .4, linkId: picture.linkId })
    document.media[1].hasAudio = false
    const silent = valid(landVideoEditInPlaceResult(document, plan, 'gen-item').document)
    expect(sequenceOf(silent).clips.filter(value => value.kind === 'audio')).toHaveLength(0)
    expect(sequenceOf(valid(switchVideoEditClipTake(silent, sequenceId, 'b', 0))).clips.filter(value => value.kind === 'audio')).toHaveLength(1)
  })
  it('锁定的链接声音拒绝替换，不留半个更新', () => {
    const { document, sequenceId, video, audio } = fixture()
    document.media[0].hasAudio = true; document.media[1].hasAudio = true
    sequenceOf(document).clips = placeVideoEditItem(document, 'item', sequenceId, { frame: 0, track: video, duration: 60 }).clips
    const clipId = sequenceOf(document).clips[0].id
    sequenceOf(document).tracks.find(value => value.index === audio)!.locked = true
    const plan = planVideoEditInPlaceGeneration(document, sequenceId, { action: 'replace_shot', clipId })
    expect(() => landVideoEditInPlaceResult(document, plan, 'gen-item')).toThrow('链接声音所在轨道已锁定')
    expect(sequenceOf(document).clips.every(value => value.itemId === 'item')).toBe(true)
  })
  it('多声道结果复用普通导入布局，各声音分量选择不同空轨且保留映射', () => {
    const { document, sequenceId, video } = fixture()
    const media = document.media.find(value => value.id === 'gen')!
    media.hasAudio = true; media.audioStreams = [{ channels: 2 }, { channels: 1 }]
    const landed = landVideoEditInPlaceResult(document, planVideoEditInPlaceGeneration(document, sequenceId, { action: 'generate_shot', frame: 60, trackIndex: video }), 'gen-item')
    const result = sequenceOf(valid(landed.document)); const primary = result.clips.find(value => value.id === landed.clipId)!
    const audio = result.clips.filter(value => value.kind === 'audio' && value.linkId === primary.linkId)
    expect(audio).toHaveLength(2); expect(new Set(audio.map(value => value.track)).size).toBe(2)
    expect(audio[1].audioMapping).toEqual({ format: 'mono', sources: [{ stream: 1, channel: 0 }] })
  })
  it('落进空隙：生成结果比空隙短时片段跟着变短，记住来源', () => {
    const { document, sequenceId, video } = fixture()
    const plan = planVideoEditInPlaceGeneration(document, sequenceId, { action: 'generate_shot', frame: 60, trackIndex: video })
    const landed = landVideoEditInPlaceResult(document, plan, 'gen-item', { type: 'generation', recordId: 'task-1', outputIndex: 0 })
    const clip = sequenceOf(valid(landed.document)).clips.find(value => value.id === landed.clipId)!
    // 4 秒的结果放进 3 秒空隙：不超出空隙
    expect(clip).toMatchObject({ itemId: 'gen-item', start: 60, duration: 90, track: video, creativeSource: { type: 'generation', recordId: 'task-1' } })
    expect(landed.newTrack).toBe(false)
    // 序列末尾默认 5 秒，结果只有 4 秒：片段 4 秒
    const tail = landVideoEditInPlaceResult(document, planVideoEditInPlaceGeneration(document, sequenceId, { action: 'generate_shot', frame: 300, trackIndex: video }), 'gen-item')
    expect(sequenceOf(tail.document).clips.find(value => value.id === tail.clipId)).toMatchObject({ start: 300, duration: 120 })
  })
  it('生成期间原落点被占：新建轨道放上去，不覆盖后来的片段', () => {
    const { document, sequenceId, video } = fixture()
    const plan = planVideoEditInPlaceGeneration(document, sequenceId, { action: 'generate_shot', frame: 60, trackIndex: video })
    const sequence = sequenceOf(document)
    sequence.clips.push({ ...sequence.clips[0], id: 'later', start: 70, duration: 20 })
    const landed = landVideoEditInPlaceResult(document, plan, 'gen-item')
    const result = sequenceOf(valid(landed.document))
    expect(landed).toMatchObject({ newTrack: true, fallback: 'slot_taken' })
    expect(result.clips.find(value => value.id === 'later')).toMatchObject({ start: 70, duration: 20, track: video })
    expect(result.clips.find(value => value.id === landed.clipId)!.track).toBeGreaterThan(video)
  })
  it('延长跟着原片段走并插入：后面的片段后移', () => {
    const { document, sequenceId } = fixture()
    const plan = planVideoEditInPlaceGeneration(document, sequenceId, { action: 'extend_shot', clipId: 'a', duration: 30 })
    sequenceOf(document).clips[0].start = 30 // 生成期间 a 被移到 30
    const result = sequenceOf(valid(landVideoEditInPlaceResult(document, plan, 'gen-item').document))
    expect(result.clips.find(value => value.itemId === 'gen-item')).toMatchObject({ start: 90, duration: 30 })
    expect(result.clips.find(value => value.id === 'b')!.start).toBe(180)
  })
  it('替换保留位置与属性，原镜头可切回并恢复原长度', () => {
    const { document, sequenceId } = fixture()
    const plan = planVideoEditInPlaceGeneration(document, sequenceId, { action: 'replace_shot', clipId: 'b' })
    const replaced = valid(landVideoEditInPlaceResult(document, plan, 'gen-item').document)
    const clip = sequenceOf(replaced).clips.find(value => value.id === 'b')!
    expect(clip).toMatchObject({ itemId: 'gen-item', start: 150, duration: 60, x: 0.25, opacity: 0.5, sourceInUs: 0 })
    expect(clip.takes).toEqual([expect.objectContaining({ itemId: 'item', duration: 60, sourceInUs: 5_000_000 })])
    const back = sequenceOf(valid(switchVideoEditClipTake(replaced, sequenceId, 'b', 0))).clips.find(value => value.id === 'b')!
    expect(back).toMatchObject({ itemId: 'item', duration: 60, x: 0.25 })
    expect(videoEditSourceSeconds(back)).toBe(5)
    expect(back.takes).toEqual([expect.objectContaining({ itemId: 'gen-item' })])
  })
  it('切回时素材已移除则拒绝；配音替换声音片段', () => {
    const { document, sequenceId, audio } = fixture()
    const replaced = landVideoEditInPlaceResult(document, planVideoEditInPlaceGeneration(document, sequenceId, { action: 'replace_shot', clipId: 'b' }), 'gen-item').document
    expect(() => switchVideoEditClipTake({ ...replaced, items: replaced.items.filter(item => item.id !== 'item') }, sequenceId, 'b', 0)).toThrow('已从项目中移除')
    const plan = planVideoEditInPlaceGeneration(document, sequenceId, { action: 'generate_audio', frame: 0, trackIndex: audio, duration: 90 })
    const landed = landVideoEditInPlaceResult(document, plan, 'voice-item')
    expect(sequenceOf(valid(landed.document)).clips.find(value => value.id === landed.clipId)).toMatchObject({ kind: 'audio', track: audio, start: 0, duration: 60 })
    expect(() => landVideoEditInPlaceResult(document, plan, 'gen-item')).toThrow('不是声音')
  })
})
