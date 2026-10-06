import { describe, expect, it } from 'vitest'
import { createVideoEditDocument, videoEditDocumentSchema, type VideoEditClip, type VideoEditDocument } from './document'
import { makeVideoEditItemClip } from './projectItems'
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
