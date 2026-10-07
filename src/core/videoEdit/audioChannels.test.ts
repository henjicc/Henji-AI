import { createVideoEditTestDocument as createVideoEditDocument } from './testFixtures'
import { describe, expect, it } from 'vitest'
import { videoEditDocumentSchema, type VideoEditDocument, type VideoEditMedia } from './document'
import {
  videoEditAudioMixReads, videoEditAudioPresetLayout, videoEditAudioPresetOf, videoEditAudioSourceLabel, videoEditClipAudioFormat, videoEditDefaultAudioGains,
  videoEditFileAudioLayout, videoEditIsDefaultAudioMapping, videoEditItemAudioLayout, videoEditSequentialAudioLayout, type VideoEditAudioMapping, type VideoEditAudioStream,
} from './audioChannels'
import { makeVideoEditItemClip, placeVideoEditItem, placeVideoEditItems, makeVideoEditItemSequence } from './projectItems'
import { applyVideoEditTimelineEdit, applyVideoEditTimelineEditResult } from './timelineEdits'
import { addLegacyVideoEditTracks } from './testFixtures'

const mono = (stream: number, channel = 0): VideoEditAudioMapping => ({ format: 'mono', sources: [{ stream, channel }] })
const stereo = (left: [number, number], right: [number, number]): VideoEditAudioMapping => ({ format: 'stereo', sources: [{ stream: left[0], channel: left[1] }, { stream: right[0], channel: right[1] }] })
const MXF: VideoEditAudioStream[] = [{ channels: 1 }, { channels: 1 }, { channels: 1 }, { channels: 1 }]
const OBS: VideoEditAudioStream[] = [{ channels: 2, sampleRate: 48000 }, { channels: 2, sampleRate: 48000 }]
const MIXED: VideoEditAudioStream[] = [{ channels: 2 }, { channels: 1 }]

function project(streams: VideoEditAudioStream[] | undefined, kind: 'video' | 'audio' = 'video'): VideoEditDocument {
  const document = createVideoEditDocument('多音轨'); addLegacyVideoEditTracks(document.sequences[0])
  const media: VideoEditMedia = { id: 'media', name: '素材', kind, path: 'D:/a.mxf', width: kind === 'video' ? 1920 : 0, height: kind === 'video' ? 1080 : 0, durationSeconds: 10, hasAudio: true, ...(kind === 'video' ? { frameRate: { numerator: 30, denominator: 1 }, frameRateMode: 'sampled-constant' as const } : {}), ...(streams ? { audioStreams: streams } : {}) }
  document.media = [media]
  document.items = [{ id: 'item', name: '素材', kind, mediaId: 'media' }]
  return document
}
const withItemLayout = (document: VideoEditDocument, layout: VideoEditAudioMapping[]): VideoEditDocument => ({ ...document, items: document.items.map(item => ({ ...item, audioChannels: layout })) })
function placeInto(document: VideoEditDocument, placed: ReturnType<typeof placeVideoEditItem>): VideoEditDocument {
  return videoEditDocumentSchema.parse({ ...document, sequences: document.sequences.map((sequence, index) => index ? sequence : { ...sequence, tracks: [...sequence.tracks, ...placed.addedTracks], clips: [...sequence.clips, ...placed.clips] }) })
}

describe('声道配置（Premiere 修改音频声道）', () => {
  it('使用文件：单声道流成单声道片段，其余流取前左前右成立体声片段；预设单声道/立体声按源声道顺序分配并可回认', () => {
    expect(videoEditFileAudioLayout(MXF)).toEqual([mono(0), mono(1), mono(2), mono(3)])
    expect(videoEditFileAudioLayout(OBS)).toEqual([stereo([0, 0], [0, 1]), stereo([1, 0], [1, 1])])
    expect(videoEditFileAudioLayout([{ channels: 6 }])).toEqual([stereo([0, 0], [0, 1])])
    expect(videoEditFileAudioLayout(MIXED)).toEqual([stereo([0, 0], [0, 1]), mono(1)])
    // Two mono streams merged into one stereo clip, and a stereo stream broken out into two mono clips.
    expect(videoEditAudioPresetLayout(MXF, 'stereo')).toEqual([stereo([0, 0], [1, 0]), stereo([2, 0], [3, 0])])
    expect(videoEditAudioPresetLayout(OBS, 'mono')).toEqual([mono(0, 0), mono(0, 1), mono(1, 0), mono(1, 1)])
    expect(videoEditAudioPresetLayout(MIXED, 'stereo')).toEqual([stereo([0, 0], [0, 1]), stereo([1, 0], [1, 0])])
    expect(videoEditSequentialAudioLayout(MXF, 'mono', 6).map(mapping => mapping.sources[0].stream)).toEqual([0, 1, 2, 3, 3, 3])
    expect(videoEditAudioPresetOf(undefined, MXF)).toBe('file')
    expect(videoEditAudioPresetOf(videoEditAudioPresetLayout(MXF, 'stereo'), MXF)).toBe('stereo')
    expect(videoEditAudioPresetOf([mono(2), mono(0)], MXF)).toBe('custom')
    expect(videoEditIsDefaultAudioMapping(stereo([0, 0], [0, 1]), OBS)).toBe(true)
    expect(videoEditIsDefaultAudioMapping(mono(0, 1), OBS)).toBe(false)
    expect(videoEditIsDefaultAudioMapping(mono(0), undefined)).toBe(false)
    expect(videoEditAudioSourceLabel({ stream: 1, channel: 1 }, OBS)).toBe('声音流 2 · 右')
    expect(videoEditAudioSourceLabel({ stream: 0, channel: 0 }, [{ channels: 1 }])).toBe('单声道')
    expect(videoEditAudioSourceLabel({ stream: 0, channel: 2 }, [{ channels: 6 }])).toBe('声道 3')
  })

  it('混音路由：单声道片段在立体声序列居中、立体声片段左右分开、单声道序列取平均，同一流只读一次；无映射片段沿用原规则', () => {
    expect(videoEditAudioMixReads(mono(2), 2)).toEqual([{ stream: 2, gains: [[1], [1]] }])
    expect(videoEditAudioMixReads(mono(0, 1), 2)).toEqual([{ stream: 0, gains: [[0, 1], [0, 1]] }])
    expect(videoEditAudioMixReads(stereo([0, 0], [0, 1]), 2)).toEqual([{ stream: 0, gains: [[1, 0], [0, 1]] }])
    expect(videoEditAudioMixReads(stereo([0, 0], [1, 0]), 2)).toEqual([{ stream: 0, gains: [[1], [0]] }, { stream: 1, gains: [[0], [1]] }])
    expect(videoEditAudioMixReads(stereo([0, 1], [0, 0]), 1)).toEqual([{ stream: 0, gains: [[0.5, 0.5]] }])
    expect(videoEditAudioMixReads(stereo([1, 0], [1, 0]), 2)).toEqual([{ stream: 1, gains: [[1], [1]] }])
    expect(videoEditDefaultAudioGains(6, 2)).toEqual([[1, 0, 0, 0, 0, 0], [0, 1, 0, 0, 0, 0]])
    expect(videoEditDefaultAudioGains(1, 2)).toEqual([[1], [1]])
    expect(videoEditDefaultAudioGains(2, 1)).toEqual([[0.5, 0.5]])
  })

  it('素材、素材项和片段只加可选字段：旧剪辑原样通过；映射须落在素材声音流内，静音画面片段不能带映射', () => {
    const legacy = project(undefined)
    expect(videoEditDocumentSchema.parse(legacy)).toEqual(legacy)
    expect(videoEditItemAudioLayout(legacy.items[0], legacy.media[0])).toBeUndefined()
    const document = project(MXF)
    expect(() => videoEditDocumentSchema.parse(withItemLayout(document, [mono(4)]))).toThrow('没有声音流 5 的第 1 个声道')
    expect(() => videoEditDocumentSchema.parse(withItemLayout(document, [mono(0), stereo([1, 0], [2, 0])]))).toThrow('同一种声道格式')
    // Media without a stream list accepts any mapping (it is checked once the list is read).
    expect(() => videoEditDocumentSchema.parse(withItemLayout(legacy, [mono(3)]))).not.toThrow()
    const placed = placeInto(document, placeVideoEditItem(document, 'item', document.sequences[0].id, { frame: 0 }))
    const picture = placed.sequences[0].clips.find(clip => clip.sourceComponent === 'video')!
    expect(() => videoEditDocumentSchema.parse({ ...placed, sequences: [{ ...placed.sequences[0], clips: placed.sequences[0].clips.map(clip => clip.id === picture.id ? { ...clip, audioMapping: mono(0) } : clip) }] })).toThrow('只有发声的音视频片段')
    expect(() => videoEditDocumentSchema.parse({ ...placed, sequences: [{ ...placed.sequences[0], clips: placed.sequences[0].clips.map(clip => clip.sourceComponent === 'audio' ? { ...clip, audioMapping: mono(0, 1) } : clip) }] })).toThrow('没有声音流 1 的第 2 个声道')
  })
})

describe('放入时间线铺轨（Premiere 默认音轨“使用文件”）', () => {
  it('MXF 四条单声道：画面加四个单声道片段铺在相邻音频轨，全部互相链接，不够的音频轨在最后一条音频轨下方新增', () => {
    const document = project(MXF)
    const sequence = document.sequences[0]
    const placed = placeVideoEditItem(document, 'item', sequence.id, { frame: 30 })
    const result = placeInto(document, placed).sequences[0]
    expect(placed.addedTracks.map(track => [track.name, track.index, track.kind])).toEqual([['音频 2', 8, 'audio'], ['音频 3', 9, 'audio'], ['音频 4', 10, 'audio']])
    const [picture, ...sound] = placed.clips
    expect(picture).toMatchObject({ kind: 'video', sourceComponent: 'video', track: 1, start: 30, duration: 300 })
    expect(picture.audioMapping).toBeUndefined()
    expect(sound.map(clip => [clip.kind, clip.sourceComponent, clip.track, clip.audioMapping?.sources[0].stream ?? 0, clip.start, clip.duration])).toEqual([['audio', 'audio', 0, 0, 30, 300], ['audio', 'audio', 8, 1, 30, 300], ['audio', 'audio', 9, 2, 30, 300], ['audio', 'audio', 10, 3, 30, 300]])
    // The first stream played as a mono file needs no mapping; the others name their stream.
    expect(sound[0].audioMapping).toBeUndefined()
    expect(new Set(placed.clips.map(clip => clip.linkId)).size).toBe(1)
    expect(placed.clips[0].linkId).toBeTruthy()
    expect(result.clips.map(clip => videoEditClipAudioFormat(clip, document.media[0]))).toEqual([undefined, 'mono', 'mono', 'mono', 'mono'])
    // A second item placed afterwards reuses the added tracks instead of adding more.
    const twice = placeVideoEditItems(document, ['item', 'item'], sequence.id, { frame: 0 })
    expect(twice.addedTracks).toHaveLength(3)
    expect(twice.clips.filter(clip => clip.kind === 'audio').map(clip => clip.track)).toEqual([0, 8, 9, 10, 0, 8, 9, 10])
    expect(twice.clips.filter(clip => clip.kind === 'audio').map(clip => clip.start)).toEqual([0, 0, 0, 0, 300, 300, 300, 300])
    expect(twice.primaryIds).toHaveLength(2)
  })

  it('OBS 双轨立体声与 MOV 立体声加单声道：每条声音流一个片段，类型分别为立体声/单声道；目标音频轨与锁定轨决定落点', () => {
    const obs = project(OBS)
    const placed = placeVideoEditItem(obs, 'item', obs.sequences[0].id, { frame: 0 })
    expect(placed.clips.slice(1).map(clip => [clip.track, clip.audioMapping ?? null])).toEqual([[0, null], [8, stereo([1, 0], [1, 1])]])
    const mixed = project(MIXED)
    // Target A2 (an existing track) and skip the locked A3 after it.
    const sequence = mixed.sequences[0]
    sequence.tracks.push({ id: 'a2', name: '音频 2', index: 12, kind: 'audio', locked: false, enabled: true, muted: false, solo: false }, { id: 'a3', name: '音频 3', index: 13, kind: 'audio', locked: true, enabled: true, muted: false, solo: false }, { id: 'a4', name: '音频 4', index: 14, kind: 'audio', locked: false, enabled: true, muted: false, solo: false })
    const targeted = placeVideoEditItem(mixed, 'item', sequence.id, { frame: 0, audioTrack: 12, videoTrack: 3 })
    expect(targeted.addedTracks).toEqual([])
    expect(targeted.clips.map(clip => [clip.track, clip.audioMapping ? videoEditClipAudioFormat(clip, mixed.media[0]) : 'file'])).toEqual([[3, 'file'], [12, 'file'], [14, 'mono']])
    expect(() => placeVideoEditItem(mixed, 'item', sequence.id, { frame: 0, audioTrack: 13 })).toThrow('已锁定')
  })

  it('有声视频一律拆为画面加链接音频片段（Premiere）：旧素材与单条声音流一个音频片段且不带映射，非默认布局的片段带映射；只取画面或声音的放置各取所需', () => {
    const legacy = project(undefined)
    const plain = placeVideoEditItem(legacy, 'item', legacy.sequences[0].id, { frame: 0 }).clips
    expect(plain.map(clip => [clip.kind, clip.sourceComponent, clip.track, clip.audioMapping ?? null])).toEqual([['video', 'video', 1, null], ['audio', 'audio', 0, null]])
    expect(plain[0].linkId).toBeTruthy(); expect(plain[1].linkId).toBe(plain[0].linkId)
    expect(placeVideoEditItem(legacy, 'item', legacy.sequences[0].id, { frame: 0, components: 'linked' }).clips.map(clip => clip.sourceComponent)).toEqual(['video', 'audio'])
    const single = project([{ channels: 2 }])
    expect(placeVideoEditItem(single, 'item', single.sequences[0].id, { frame: 0 }).clips.map(clip => [clip.sourceComponent, clip.audioMapping ?? null])).toEqual([['video', null], ['audio', null]])
    // A silent video stays one picture clip.
    const silent = project(undefined); silent.media[0].hasAudio = false
    expect(placeVideoEditItem(silent, 'item', silent.sequences[0].id, { frame: 0 }).clips).toEqual([expect.not.objectContaining({ sourceComponent: expect.anything() })])
    // Stereo broken out to two mono clips (Premiere Mono preset).
    const brokenOut = withItemLayout(single, videoEditAudioPresetLayout([{ channels: 2 }], 'mono'))
    expect(placeVideoEditItem(brokenOut, 'item', single.sequences[0].id, { frame: 0 }).clips.map(clip => [clip.sourceComponent, clip.audioMapping ?? null])).toEqual([['video', null], ['audio', mono(0, 0)], ['audio', mono(0, 1)]])
    // Two mono streams merged into one stereo clip.
    const merged = withItemLayout(project([{ channels: 1 }, { channels: 1 }]), [stereo([0, 0], [1, 0])])
    expect(placeVideoEditItem(merged, 'item', merged.sequences[0].id, { frame: 0 }).clips.map(clip => [clip.sourceComponent, clip.audioMapping ?? null])).toEqual([['video', null], ['audio', stereo([0, 0], [1, 0])]])
    const mxf = project(MXF)
    expect(placeVideoEditItem(mxf, 'item', mxf.sequences[0].id, { frame: 0, components: 'video' }).clips).toEqual([expect.objectContaining({ sourceComponent: 'video' })])
    const audioOnly = placeVideoEditItem(mxf, 'item', mxf.sequences[0].id, { frame: 0, components: 'audio' })
    expect(audioOnly.clips.map(clip => clip.sourceComponent)).toEqual(['audio', 'audio', 'audio', 'audio'])
    expect(new Set(audioOnly.clips.map(clip => clip.linkId)).size).toBe(1)
    // A sound-only file with several streams links its clips to each other.
    const wave = project(OBS, 'audio')
    const sound = placeVideoEditItem(wave, 'item', wave.sequences[0].id, { frame: 0 })
    expect(sound.clips.map(clip => [clip.kind, clip.sourceComponent ?? null, clip.track])).toEqual([['audio', null, 0], ['audio', null, 8]])
    expect(sound.clips[0].linkId).toBe(sound.clips[1].linkId)
  })

  it('按素材新建序列也铺轨；序列最多 32 条轨道时给出可行动提示', () => {
    const document = project(MXF)
    const sequence = makeVideoEditItemSequence(document, ['item'])
    expect(sequence.tracks.filter(track => track.kind === 'audio')).toHaveLength(4)
    expect(sequence.clips).toHaveLength(5)
    const crowded = project(Array.from({ length: 16 }, () => ({ channels: 1 })))
    crowded.sequences[0].tracks.push(...Array.from({ length: 20 }, (_, index) => ({ id: `v${index}`, name: `视频 ${index + 8}`, index: index + 8, kind: 'video' as const, locked: false, enabled: true, muted: false, solo: false })))
    expect(() => placeVideoEditItem(crowded, 'item', crowded.sequences[0].id, { frame: 0 })).toThrow('序列最多 32 条轨道')
  })

  it('放置编辑可同时新增音频轨（插入/覆盖同一撤销步），新增轨无效时拒绝；拆开音画时声音带走映射、画面不再带映射', () => {
    const document = project(MXF)
    const sequence = document.sequences[0]
    const placed = placeVideoEditItem(document, 'item', sequence.id, { frame: 0, audioTrack: 0, videoTrack: 1 })
    const tracks = [...sequence.tracks, ...placed.addedTracks].map(track => ({ index: track.index, kind: track.kind }))
    const result = applyVideoEditTimelineEditResult(document, sequence.id, { kind: 'place', mode: 'insert', frame: 0, clipboard: { projectId: document.id, frameRate: sequence.frameRate, clips: placed.clips, annotations: [], tracks }, newTracks: placed.addedTracks })
    expect(result.sequence.tracks).toHaveLength(11)
    expect(result.selectedClipIds).toHaveLength(5)
    expect(() => applyVideoEditTimelineEdit(document, sequence.id, { kind: 'place', mode: 'paste', frame: 0, clipboard: { projectId: document.id, frameRate: sequence.frameRate, clips: placed.clips, annotations: [], tracks } })).toThrow('目标轨道与片段类型不匹配')
    expect(() => applyVideoEditTimelineEdit(document, sequence.id, { kind: 'place', mode: 'paste', frame: 0, clipboard: { projectId: document.id, frameRate: sequence.frameRate, clips: placed.clips, annotations: [], tracks }, newTracks: [{ ...placed.addedTracks[0], index: 1 }] })).toThrow('新增的轨道无效')
    // A picture-and-sound clip of an older project carrying a mapping keeps it on the separated sound.
    const merged = project([{ channels: 1 }, { channels: 1 }])
    const old = { ...makeVideoEditItemClip(merged, 'item', merged.sequences[0].id, { frame: 0 }), audioMapping: stereo([0, 0], [1, 0]) }
    const combined = videoEditDocumentSchema.parse({ ...merged, sequences: [{ ...merged.sequences[0], clips: [old] }] })
    const separated = applyVideoEditTimelineEdit(combined, combined.sequences[0].id, { kind: 'separate_audio', clipIds: [combined.sequences[0].clips[0].id], audioTrack: 0 })
    expect(separated.clips.map(clip => [clip.sourceComponent, clip.audioMapping ?? null])).toEqual([['video', null], ['audio', stereo([0, 0], [1, 0])]])
  })
})
