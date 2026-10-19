import { describe, expect, it } from 'vitest'
import { createVideoEditDocument, createVideoEditSequence, videoEditComposition, type VideoEditClip } from './document'
import { addLegacyVideoEditTracks } from './testFixtures'
import { collectVideoEditReviewStructure, selectVideoEditReviewFrames, videoEditTrackingReviewRanges, type VideoEditReviewRecord } from './review'
import { VideoEditSourceMapIndex, projectVideoEditSourceMapRanges, projectVideoEditTrackingRanges, videoEditSourceMapTrackingRange } from './sourceMap'
import { videoEditNestedFrame } from './nestedSequences'
import { createVideoEditTrackHeader, type VideoEditTrackBox } from './tracking'

function fixture() {
  const document = createVideoEditDocument('检查点'); const sequence = createVideoEditSequence('主'); sequence.id = 'root'; addLegacyVideoEditTracks(sequence)
  document.sequences = [sequence]
  document.media = [{ id: 'media', kind: 'video', name: '视频', path: '/review.mp4', width: 64, height: 64, durationSeconds: 30 }]
  document.items = [{ id: 'item', kind: 'video', name: '视频', mediaId: 'media' }]
  return { document, sequence }
}
function clip(id: string, patch: Partial<VideoEditClip> = {}): VideoEditClip {
  return { id, name: id, kind: 'video', itemId: 'item', track: 1, start: 0, duration: 60, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: .5, y: .5, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '', ...patch }
}
const budget = () => ({ remaining: 200000 })
const box = (confidence: number): VideoEditTrackBox => [0, 0, .5, .5, confidence]
function header(boxes: Array<VideoEditTrackBox | null>, firstFrame = 0) {
  return createVideoEditTrackHeader({ method: 'box', model: 'test', fps: 10, firstFrame, frameCount: boxes.length, sourceWidth: 64, sourceHeight: 64, promptFrames: [], boxes, summary: { tracked: boxes.filter(Boolean).length, lost: boxes.filter(value => !value).length } })
}

describe('自动检查点与原始跟踪证据', () => {
  it('字幕、效果显隐和转场都提供边界，停用效果与隐藏轨不制造候选', () => {
    const { document, sequence } = fixture()
    sequence.clips = [clip('a', { curves: { opacity: [{ time: 12, value: 0, interpolation: 'hold' }] }, effects: [{ id: 'on', name: '启用', enabled: true, amount: 1, builtin: { id: 'gaussian_blur', params: {}, curves: { radius: [{ time: 23, value: 0, interpolation: 'hold' }] } } }, { id: 'off', name: '停用', enabled: false, amount: 1 }] }), clip('b', { start: 60 })]
    sequence.captions = [{ id: 'caption', text: '字幕', start: 25, duration: 10 }]
    sequence.transitions = [{ id: 'cut', kind: 'cross_dissolve', leftClipId: 'a', rightClipId: 'b', durationFrames: 10 }]
    const { records } = collectVideoEditReviewStructure(videoEditComposition(document, 'root'), { from: 0, to: 120 })
    expect(records.find(record => record.kind === 'caption')?.timeline).toEqual({ from: 25, to: 35 })
    expect(records.find(record => record.kind === 'transition')?.timeline).toEqual({ from: 55, to: 65 })
    expect(records.filter(record => record.kind === 'effect').map(record => record.timeline.from)).toEqual(expect.arrayContaining([0, 12, 23, 60]))
    expect(records.some(record => record.subjectId === 'off')).toBe(false)
    expect(records.some(record => record.kind === 'clip_boundary' && record.timeline.from === 60)).toBe(true)
    sequence.clips[0].effectsEnabled = false; sequence.clips[0].disabledIntrinsicSections = ['opacity']
    expect(collectVideoEditReviewStructure(videoEditComposition(document, 'root'), { from: 0, to: 120 }).records.some(record => record.kind === 'effect')).toBe(false)
    sequence.tracks.find(track => track.index === 1)!.enabled = false
    expect(collectVideoEditReviewStructure(videoEditComposition(document, 'root'), { from: 0, to: 120 }).records.map(record => record.kind)).toEqual(['caption'])
  })
  it('没有叶子片段的字幕子序列也检查，两次放置各自返回完整实例路径', () => {
    const { document, sequence } = fixture(); const child = createVideoEditSequence('只有字幕'); child.id = 'child'
    child.captions = [{ id: 'word', text: '子字幕', start: 10, duration: 10 }]; document.sequences.push(child)
    document.items.push({ id: 'nested', name: '子', kind: 'sequence', sequenceId: 'child' })
    sequence.clips = [clip('one', { kind: 'sequence', itemId: 'nested', duration: 20 }), clip('two', { kind: 'sequence', itemId: 'nested', start: 50, duration: 20 })]
    const result = collectVideoEditReviewStructure(videoEditComposition(document, 'root'), { from: 0, to: 70 }).records.filter(record => record.kind === 'caption')
    expect(result.map(record => record.timeline)).toEqual([{ from: 10, to: 20 }, { from: 60, to: 70 }])
    expect(result.map(record => record.path.map(step => step.clipId))).toEqual([['one'], ['two']])
    expect(new VideoEditSourceMapIndex().query(videoEditComposition(document, 'root'), { from: 0, to: 70 })).toEqual([])
  })
  it.each([false, true])('混合帧率、变速和倒放=%s时字幕范围逐帧对照正式嵌套时钟', reverse => {
    const { document, sequence } = fixture(); const child = createVideoEditSequence('子'); child.id = 'child'; child.frameRate = { numerator: 24, denominator: 1 }
    child.captions = [{ id: 'word', text: '字幕', start: 9, duration: 17 }]; child.clips = [clip('leaf', { duration: 50 })]
    document.sequences.push(child); document.items.push({ id: 'nested', kind: 'sequence', name: '子', sequenceId: 'child' })
    const parent = clip('parent', { kind: 'sequence', itemId: 'nested', start: 3, duration: 20, speed: { numerator: 2, denominator: 1 }, ...(reverse ? { reverse: true } : {}), sourceInUs: reverse ? 1400000 : 0 }); sequence.clips = [parent]
    const result = collectVideoEditReviewStructure(videoEditComposition(document, 'root'), { from: 0, to: 30 }).records.filter(record => record.kind === 'caption')
    const actual = Array.from({ length: 30 }, (_, frame) => frame).filter(frame => frame >= 3 && frame < 23 && videoEditNestedFrame({ fps: 30 }, parent, { fps: 24 }, frame) >= 9 && videoEditNestedFrame({ fps: 30 }, parent, { fps: 24 }, frame) < 26)
    expect(actual.length).toBeGreaterThan(0)
    expect(result).toHaveLength(1); expect(result[0].timeline).toEqual({ from: actual[0], to: actual.at(-1)! + 1 })
  })
  it('高倍速跳过关键帧时选择首次跨越边界的帧，而非丢失该检查点', () => {
    const { document, sequence } = fixture(); const child = createVideoEditSequence('子'); child.id = 'child'
    child.clips = [clip('leaf', { curves: { opacity: [{ time: 11, value: 0, interpolation: 'hold' }] } })]
    document.sequences.push(child); document.items.push({ id: 'nested', kind: 'sequence', name: '子', sequenceId: 'child' })
    sequence.clips = [clip('parent', { kind: 'sequence', itemId: 'nested', duration: 25, speed: { numerator: 2, denominator: 1 } })]
    const result = collectVideoEditReviewStructure(videoEditComposition(document, 'root'), { from: 0, to: 25 }).records
    expect(result.find(record => record.kind === 'effect' && record.subjectId === 'leaf')?.timeline.from).toBe(6)
  })
  it('连续跟丢、低置信度和未覆盖各自压缩，保留最小置信度，不因渲染借帧掩盖跟丢', () => {
    const result = videoEditTrackingReviewRanges(header([box(.9), null, null, box(.4), box(.2), box(.8)], 2), { fromUs: 0, toUs: 1000000 }, .5, budget())
    expect(result).toEqual([
      { kind: 'tracking_uncovered', fromUs: 0, toUs: 200000 }, { kind: 'tracking_lost', fromUs: 300000, toUs: 500000 },
      { kind: 'tracking_low_confidence', fromUs: 500000, toUs: 700000, confidence: .2 }, { kind: 'tracking_uncovered', fromUs: 800000, toUs: 1000000 },
    ])
  })
  it('窄范围只扫描对应跟踪帧，预算不足显式失败，异常置信度不被当作正常', () => {
    const data = header(Array.from({ length: 100 }, () => box(.9)))
    expect(videoEditTrackingReviewRanges(data, { fromUs: 8000000, toUs: 8200000 }, .5, { remaining: 2 })).toEqual([])
    expect(() => videoEditTrackingReviewRanges(data, { fromUs: 0, toUs: 10000000 }, .5, { remaining: 2 })).toThrow('预算')
    expect(() => videoEditTrackingReviewRanges(header([box(NaN)]), { fromUs: 0, toUs: 100000 }, .5, budget())).toThrow('置信度')
    expect(videoEditTrackingReviewRanges({ ...header([box(.9)], 1), fps: 30 }, { fromUs: 33333, toUs: 33334 }, .5, budget())).toEqual([])
  })
  it('跟踪源区间投影到倒放、变速和重复实例，不混为一个成片位置', () => {
    const { document, sequence } = fixture()
    sequence.clips = [clip('first', { duration: 30, speed: { numerator: 2, denominator: 1 } }), clip('again', { start: 40, duration: 60, reverse: true, sourceInUs: 2000000 })]
    const entries = new VideoEditSourceMapIndex().query(videoEditComposition(document, 'root'), { from: 0, to: 100 }, ['video'])
    const fact = videoEditTrackingReviewRanges(header([box(.9), null, null, box(.9)]), { fromUs: 0, toUs: 400000 }, .5, budget())[0]
    expect(entries.map(entry => projectVideoEditSourceMapRanges(entry, [fact]))).toEqual([[{ from: 2, to: 5 }], [{ from: 91, to: 97 }]])
  })
  it('转场取画面余量时跟踪仍保持片段端点；图片跟踪只复核源时间0', () => {
    const { document, sequence } = fixture()
    sequence.clips = [clip('a'), clip('b', { start: 60, sourceInUs: 1000000 })]
    sequence.transitions = [{ id: 'transition', kind: 'cross_dissolve', leftClipId: 'a', rightClipId: 'b', durationFrames: 30 }]
    const entry = new VideoEditSourceMapIndex().query(videoEditComposition(document, 'root'), { from: 45, to: 70 }, ['video']).find(entry => entry.path[0].clipId === 'b')!
    expect(entry.firstSample?.sourceUs).toBe(500000)
    expect(videoEditSourceMapTrackingRange(entry).fromUs).toBe(1000000)
    expect(projectVideoEditTrackingRanges(entry, [{ fromUs: 1000000, toUs: 1100000 }])).toEqual([{ from: 45, to: 63 }])
    document.media[0].kind = 'image'; sequence.transitions = []; sequence.clips = [clip('still', { kind: 'image' })]
    const still = new VideoEditSourceMapIndex().query(videoEditComposition(document, 'root'), { from: 0, to: 60 }, ['video'])[0]
    expect(videoEditSourceMapTrackingRange(still)).toEqual({ fromUs: 0, toUs: 1 })
    expect(projectVideoEditTrackingRanges(still, [{ fromUs: 0, toUs: 100000 }])).toEqual([{ from: 0, to: 60 }])
    expect(projectVideoEditTrackingRanges(still, [{ fromUs: 100000, toUs: 200000 }])).toEqual([])
  })
  it('图片上的代码效果沿作者源时钟选关键帧，不能被图片静帧时钟吞掉', () => {
    const { document, sequence } = fixture(); document.media[0].kind = 'image'
    sequence.clips = [clip('still', { kind: 'image', effects: [{ id: 'code', name: '代码效果', enabled: true, amount: 1, code: { definitionId: 'filter', versionId: 'version', parameters: {}, curves: { alpha: [{ id: 'fade', sourceInUs: 1000000, sourceRemainder: { numerator: 0, denominator: 1 }, value: 0, interpolation: 'hold' }] } } }] })]
    const records = collectVideoEditReviewStructure(videoEditComposition(document, 'root'), { from: 0, to: 60 }).records
    expect(records.find(record => record.subjectId === 'code' && record.timeline.from === 30)).toBeDefined()
  })
  it('有限检查帧优先跟踪异常并分散时段，边界不能越出查询或序列', () => {
    const record = (from: number, kind: VideoEditReviewRecord['kind']): VideoEditReviewRecord => ({ kind, timeline: { from, to: from + 1 }, sequenceId: 'root', path: [], subjectId: String(from) })
    const records = [record(1, 'caption'), record(40, 'tracking_lost'), record(90, 'tracking_lost'), record(99, 'transition')]
    const frames = selectVideoEditReviewFrames(records, { from: 0, to: 100 }, 2, 100)
    expect(frames).toEqual([39, 91])
    expect(selectVideoEditReviewFrames(records, { from: 0, to: 100 }, 12, 100).every(frame => frame >= 0 && frame < 100)).toBe(true)
  })
})
