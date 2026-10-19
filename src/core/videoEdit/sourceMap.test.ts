import { describe, expect, it } from 'vitest'
import { createVideoEditDocument, createVideoEditSequence, videoEditComposition, type VideoEditClip, type VideoEditDocument } from './document'
import { addLegacyVideoEditTracks } from './testFixtures'
import { VideoEditSourceMapIndex, projectVideoEditSourceMapRanges } from './sourceMap'
import { videoEditNestedFrame } from './nestedSequences'
import { videoEditClipSourceSecondsAt } from './clipSpeed'
import { createVideoEditMulticam } from './multicam'
import { makeVideoEditItemClip } from './projectItems'

function fixture() {
  const document = createVideoEditDocument('来源映射'); const sequence = createVideoEditSequence('主序列')
  sequence.id = 'root'; addLegacyVideoEditTracks(sequence); document.sequences = [sequence]
  document.media = [{ id: 'media', kind: 'video', name: '口播', path: '/source.mp4', width: 1920, height: 1080, durationSeconds: 100, hasAudio: true }]
  document.items = [{ id: 'item', name: '口播', kind: 'video', mediaId: 'media' }]
  return { document, sequence, index: new VideoEditSourceMapIndex() }
}
function clip(id: string, overrides: Partial<VideoEditClip> = {}): VideoEditClip {
  return { id, name: id, itemId: 'item', kind: 'video', track: 1, start: 0, duration: 60, sourceInUs: 1000000, sourceRemainder: { numerator: 0, denominator: 1 }, x: .5, y: .5, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '', ...overrides }
}
const read = (document: VideoEditDocument, index = new VideoEditSourceMapIndex(), range = { from: 0, to: 180 }) => index.query(videoEditComposition(document, 'root'), range)

describe('成片到来源的派生映射', () => {
  it('嵌套倒放叠加变速逐点对照正式渲染时钟，保留跳帧和重复帧', () => {
    const { document, sequence, index } = fixture(); const child = createVideoEditSequence('子'); child.id = 'child'; child.frameRate = { numerator: 24, denominator: 1 }
    const leaf = clip('inside', { start: 7, duration: 40, sourceInUs: 8000000, speed: { numerator: 1, denominator: 2 }, reverse: true })
    child.clips = [leaf]; document.sequences.push(child); document.items.push({ id: 'nested', kind: 'sequence', name: '子', sequenceId: child.id })
    const parent = clip('parent', { kind: 'sequence', itemId: 'nested', start: 5, duration: 43, sourceInUs: 2000000, reverse: true }); sequence.clips = [parent]
    for (let frame = 0; frame < 60; frame++) {
      const childFrame = videoEditNestedFrame({ fps: 30 }, parent, { fps: 24 }, frame)
      const active = frame >= parent.start && frame < parent.start + parent.duration && childFrame >= leaf.start && childFrame < leaf.start + leaf.duration
      const mapped = index.query(videoEditComposition(document, 'root'), { from: frame, to: frame + 1 }, ['video'])
      expect(mapped.length, `root frame ${frame}`).toBe(active ? 1 : 0)
      if (active) expect(mapped[0].firstSample?.sourceUs).toBe(Math.round(videoEditClipSourceSecondsAt(leaf, childFrame, 24) * 1e6))
    }
  })
  it('转场提前/延后贡献使用真实余量，视频不足时保帧、声音不足时静音', () => {
    const { document, sequence } = fixture()
    sequence.clips = [clip('left', { duration: 60, sourceInUs: 0 }), clip('right', { start: 60, duration: 60, sourceInUs: 0 })]
    sequence.transitions = [{ id: 'dissolve', kind: 'cross_dissolve', leftClipId: 'left', rightClipId: 'right', durationFrames: 30 }]
    const picture = read(document, undefined, { from: 45, to: 60 }).filter(entry => entry.medium === 'video')
    expect(picture).toHaveLength(2)
    expect(picture.find(entry => entry.path[0].clipId === 'right')).toMatchObject({ timeline: { from: 45, to: 60 }, firstSample: { frame: 45, sourceUs: 0 } })
    sequence.clips = sequence.clips.map(value => ({ ...value, kind: 'audio', track: 0 }))
    sequence.transitions = [{ id: 'crossfade', kind: 'constant_power', leftClipId: 'left', rightClipId: 'right', durationFrames: 30 }]
    const sound = read(document, undefined, { from: 45, to: 60 }).filter(entry => entry.medium === 'audio')
    expect(sound.map(entry => entry.path[0].clipId)).toEqual(['left'])
  })
  it('嵌套尾部的转场保帧与正常透明尾部分开；标记延长子时长会使旧保帧缓存失效', () => {
    const { document, sequence, index } = fixture(); const child = createVideoEditSequence('子'); child.id = 'child'; child.clips = [clip('inside', { duration: 30 })]
    document.sequences.push(child); document.items.push({ id: 'nested', name: '子', kind: 'sequence', sequenceId: child.id })
    sequence.clips = [clip('parent', { itemId: 'nested', kind: 'sequence', duration: 60, sourceInUs: 0 }), clip('right', { start: 60 })]
    sequence.transitions = [{ id: 'dissolve', kind: 'cross_dissolve', leftClipId: 'parent', rightClipId: 'right', durationFrames: 30 }]
    const before = read(document, index).filter(entry => entry.medium === 'video' && entry.path[0].clipId === 'parent')
    expect(before.map(entry => entry.timeline)).toEqual([{ from: 0, to: 30 }, { from: 60, to: 75 }])
    child.markers = [{ id: 'tail', name: '延长子时长', frame: 90 }]
    expect(read(document, index).filter(entry => entry.medium === 'video' && entry.path[0].clipId === 'parent').map(entry => entry.timeline)).toEqual([{ from: 0, to: 30 }])
  })
  it('多机位画面切换不改主声音，返回实际保存片段引用而非渲染虚拟ID', () => {
    const { document } = fixture()
    document.media.push({ ...document.media[0], id: 'other', name: '机位二' }); document.items.push({ id: 'other-item', name: '机位二', kind: 'video', mediaId: 'other' })
    const result = createVideoEditMulticam(document, 'root', { name: '多机位', sync: 'in_points', cameras: [{ itemId: 'item' }, { itemId: 'other-item' }], audioCameraIndex: 0 })
    const root = result.document.sequences[0]; const cameras = result.sequence.multicam!.cameras
    root.clips = [{ ...makeVideoEditItemClip(result.document, result.itemId, root.id, { frame: 0, duration: 60 }), multicamCameraId: cameras[1].id }]
    const entries = read(result.document)
    const sound = entries.find(entry => entry.medium === 'audio')!; const picture = entries.find(entry => entry.medium === 'video')!
    expect(sound.mediaId).toBe('media'); expect(picture.mediaId).toBe('other')
    expect(sound.path.at(-1)?.clipId).toBe(cameras[0].clipId)
    expect(picture.path.at(-1)?.clipId).toBe(cameras[1].clipId)
  })
  it('区分同素材重复实例、变速和倒放，声音连续边界与画面采样分别回读', () => {
    const { document, sequence } = fixture()
    sequence.clips = [clip('a', { start: 30, speed: { numerator: 2, denominator: 1 } }), clip('b', { start: 100, duration: 30, sourceInUs: 4000000, reverse: true })]
    const entries = read(document)
    const a = entries.find(entry => entry.medium === 'audio' && entry.path[0].clipId === 'a')!
    expect(a).toMatchObject({ timeline: { from: 30, to: 90 }, source: { fromUs: 1000000, toUs: 5000000, direction: 'forward', basis: 'continuous_audio' } })
    const b = entries.find(entry => entry.medium === 'video' && entry.path[0].clipId === 'b')!
    expect(b).toMatchObject({ timeline: { from: 100, to: 130 }, source: { fromUs: 3000000, toUs: 4000000, direction: 'reverse', basis: 'sampled_envelope' }, firstSample: { frame: 100, sourceUs: 3966667 } })
    expect(projectVideoEditSourceMapRanges(a, [{ fromUs: 2000000, toUs: 3000000 }])).toEqual([{ from: 45, to: 60 }])
    expect(projectVideoEditSourceMapRanges(b, [{ fromUs: 3000000, toUs: 3500000 }])).toEqual([{ from: 115, to: 130 }])
    expect(projectVideoEditSourceMapRanges(b, [{ fromUs: 3500000, toUs: 3500000 }])).toEqual([{ from: 115, to: 115 }])
    expect(new Set(entries.map(entry => entry.id)).size).toBe(entries.length)
  })
  it('混合帧率嵌套沿渲染取帧，父倒放保留独立路径，子序列缩短后不延长最后画面', () => {
    const { document, sequence } = fixture(); const child = createVideoEditSequence('子序列'); child.id = 'child'; child.frameRate = { numerator: 24, denominator: 1 }
    child.clips = [clip('inside', { duration: 24 })]; document.sequences.push(child)
    document.items.push({ id: 'nested', kind: 'sequence', name: '子序列', sequenceId: child.id })
    sequence.clips = [clip('first', { kind: 'sequence', itemId: 'nested', duration: 60, sourceInUs: 0 }), clip('second', { kind: 'sequence', itemId: 'nested', start: 60, duration: 30, sourceInUs: 1000000, reverse: true })]
    const entries = read(document).filter(entry => entry.medium === 'video')
    expect(entries.map(entry => entry.timeline)).toEqual([{ from: 0, to: 30 }, { from: 60, to: 90 }])
    expect(entries.map(entry => entry.path.map(step => step.clipId))).toEqual([['first', 'inside'], ['second', 'inside']])
    expect(entries[1].firstSample).toEqual({ frame: 60, sourceUs: 1958333 })
    expect(entries[1].source.direction).toBe('reverse')
    expect(projectVideoEditSourceMapRanges(entries[1], [{ fromUs: 1000000, toUs: 1500000 }])).toEqual([{ from: 75, to: 90 }])
  })
  it('连续声音保留子采样边界，不把音频时钟套成画面帧采样', () => {
    const { document, sequence } = fixture(); const child = createVideoEditSequence('声音'); child.id = 'child'; child.frameRate = { numerator: 24, denominator: 1 }
    child.clips = [clip('voice', { kind: 'audio', track: 0, start: 1, duration: 23, sourceInUs: 2000000 })]; document.sequences.push(child)
    document.items.push({ id: 'nested', kind: 'sequence', name: '声音', sequenceId: child.id })
    sequence.clips = [clip('parent', { kind: 'sequence', itemId: 'nested', duration: 30, sourceInUs: 0, speed: { numerator: 2, denominator: 1 } })]
    const entry = read(document).find(entry => entry.medium === 'audio')!
    expect(entry.timeline.from).toBeCloseTo(.625, 10); expect(entry.timeline.to).toBeCloseTo(15, 10)
    expect(entry.source).toMatchObject({ fromUs: 2000000, toUs: 2958333, basis: 'continuous_audio' })
    const range = projectVideoEditSourceMapRanges(entry, [{ fromUs: 2100000, toUs: 2200000 }])[0]
    expect(range.from).toBeCloseTo(2.125, 10); expect(range.to).toBeCloseTo(3.625, 10)
  })
  it('透明外框与下层画面都保留为结构候选，图片只指向资产点，静音/独奏沿现有轨道规则', () => {
    const { document, sequence } = fixture()
    document.media.push({ id: 'image', kind: 'image', name: '透明外框', path: '/frame.png', width: 1920, height: 1080, durationSeconds: 0 })
    document.items.push({ id: 'frame', kind: 'image', name: '外框', mediaId: 'image' })
    sequence.clips = [clip('video'), clip('frame', { itemId: 'frame', kind: 'image', track: 2, opacity: .4 })]
    const visual = read(document).filter(entry => entry.medium === 'video')
    expect(visual.map(entry => entry.path[0].clipId)).toEqual(['frame', 'video'])
    const frame = visual.find(entry => entry.kind === 'image')!
    expect(frame.source).toMatchObject({ basis: 'asset_point', fromUs: 0, toUs: 0 })
    expect(projectVideoEditSourceMapRanges(frame, [{ fromUs: 0, toUs: 0 }])).toEqual([{ from: 0, to: 60 }])
    sequence.tracks[1].muted = true
    expect(read(document).filter(entry => entry.medium === 'audio')).toHaveLength(0)
    sequence.tracks[2].solo = true
    expect(read(document).filter(entry => entry.medium === 'video').map(entry => entry.kind)).toEqual(['image'])
  })
  it('局部查询只映射相交区间；无关根片段改变复用既有映射，相关子序列改变使父实例失效', () => {
    const { document, sequence, index } = fixture()
    sequence.clips = [clip('a'), clip('b', { start: 90 })]
    const before = read(document, index)
    sequence.clips[1] = { ...sequence.clips[1], sourceInUs: 7000000 }
    const after = read(document, index)
    expect(after.find(entry => entry.id === before[0].id)).toBe(before[0])
    expect(after.find(entry => entry.path[0].clipId === 'b')?.source.fromUs).toBe(7000000)
    expect(read(document, index, { from: 35, to: 40 }).every(entry => entry.timeline.from === 35 && entry.timeline.to === 40)).toBe(true)
    const child = createVideoEditSequence('子'); child.id = 'child'; child.clips = [clip('leaf')]; document.sequences.push(child)
    document.items.push({ id: 'nested', kind: 'sequence', name: '子', sequenceId: child.id })
    sequence.clips[1] = clip('b', { kind: 'sequence', itemId: 'nested', start: 90, sourceInUs: 0 })
    const old = read(document, index).find(entry => entry.path[0].clipId === 'b')!
    child.clips[0] = { ...child.clips[0], sourceInUs: 5000000 }
    expect(read(document, index).find(entry => entry.path[0].clipId === 'b')?.source.fromUs).toBe(5000000)
    expect(read(document, index).find(entry => entry.id === old.id)).not.toBe(old)
  })
  it('整日长片不逐帧展开；循环与不合法范围明确失败', () => {
    const { document, sequence } = fixture(); sequence.frameRate = { numerator: 120, denominator: 1 }
    sequence.clips = [clip('long', { duration: 86400 * 120, sourceInUs: 0 })]; document.media[0].durationSeconds = 86400
    expect(read(document, undefined, { from: 0, to: 86400 * 120 })).toHaveLength(2)
    expect(() => read(document, undefined, { from: .5, to: 30 })).toThrow('整数帧')
    document.items.push({ id: 'loop', kind: 'sequence', name: '循环', sequenceId: 'root' }); sequence.clips = [clip('loop', { kind: 'sequence', itemId: 'loop' })]
    expect(() => read(document)).toThrow('循环嵌套')
  })
  it('共享嵌套图不展开指数级签名，超出单次来源预算明确要求分段而非静默截断', () => {
    const { document, sequence } = fixture()
    let childId = 'leaf'
    const leaf = createVideoEditSequence('叶子'); leaf.id = childId; leaf.clips = [clip('leaf', { duration: 30 })]; document.sequences.push(leaf)
    for (let level = 0; level < 5; level++) {
      const nested = createVideoEditSequence(`层${level}`); nested.id = `level-${level}`
      const itemId = `nested-${level}`; document.items.push({ id: itemId, name: itemId, kind: 'sequence', sequenceId: childId })
      nested.clips = Array.from({ length: 12 }, (_, index) => clip(`${level}-${index}`, { kind: 'sequence', itemId, duration: 30, sourceInUs: 0 }))
      document.sequences.push(nested); childId = nested.id
    }
    document.items.push({ id: 'root-child', kind: 'sequence', name: '共享嵌套', sequenceId: childId })
    sequence.clips = [clip('parent', { kind: 'sequence', itemId: 'root-child', duration: 30, sourceInUs: 0 })]
    expect(() => new VideoEditSourceMapIndex().query(videoEditComposition(document, 'root'), { from: 0, to: 30 }, ['video'])).toThrow('单次查询预算')
  })
})
