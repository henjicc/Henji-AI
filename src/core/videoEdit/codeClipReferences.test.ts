import { expect, it } from 'vitest'
import { createVideoEditDocument, createVideoEditSequence, splitVideoEditClip, type VideoEditClip } from './document'
import { addLegacyVideoEditTracks } from './testFixtures'
import { assertVideoEditLockedTracks } from './lockedTracks'
import { reconcileVideoEditTimedContent } from './timedContent'
import { applyVideoEditTimelineEdit } from './timelineEdits'
import { detachVideoEditRemovedCodeClipReferences, remapVideoEditCodeClipReferences, videoEditCodeClipReferenceIds, videoEditLostCodeClipReferences } from './codeClipReferences'

const base = { sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 0, text: '', itemId: 'text' }
const title = { ...base, id: 'title', kind: 'text', name: '标题', track: 1, start: 0, duration: 100 } as VideoEditClip
const code = (id: string, start: number, duration: number): VideoEditClip => ({ ...base, id, kind: 'code', name: id, track: 2, start, duration,
  code: { definitionId: 'm', versionId: 'v', parameters: { light: { kind: 'clip', clipId: 'title' }, amount: .5 } } }) as VideoEditClip

it('引用随片段换 ID 改写：给新 ID 改指、给 null 置空、给 undefined 不变；拆开被引用片段时改指重叠最多的那一半', () => {
  const ribbon = code('ribbon', 0, 100)
  expect(videoEditCodeClipReferenceIds(ribbon)).toEqual(['title'])
  expect(remapVideoEditCodeClipReferences(ribbon, () => undefined)).toBe(ribbon)
  expect(remapVideoEditCodeClipReferences(ribbon, () => 'copy').code!.parameters).toEqual({ light: { kind: 'clip', clipId: 'copy' }, amount: .5 })
  expect(remapVideoEditCodeClipReferences(ribbon, () => null).code!.parameters).toEqual({ light: null, amount: .5 })
  const sequence = { ...createVideoEditSequence('主'), clips: [title, code('early', 0, 30), code('late', 60, 40)] }
  const split = splitVideoEditClip(sequence, 'title', 50)
  const right = split.clips.find(clip => clip.kind === 'text' && clip.id !== 'title')!
  expect(videoEditCodeClipReferenceIds(split.clips.find(clip => clip.id === 'early')!)).toEqual(['title'])
  expect(videoEditCodeClipReferenceIds(split.clips.find(clip => clip.id === 'late')!)).toEqual([right.id])
})

it('删除被引用的片段后，引用它的代码参数置空，不留下引用不到的片段', () => {
  const document = createVideoEditDocument('删除'), sequence = { ...createVideoEditSequence('主'), clips: [title, code('ribbon', 0, 100)] }
  document.sequences = [sequence]; document.items = [{ id: 'text', kind: 'text', name: '文字' }]
  const next = applyVideoEditTimelineEdit(document, sequence.id, { kind: 'delete', clipIds: ['title'], linked: false })
  expect(next.clips.find(clip => clip.id === 'ribbon')!.code!.parameters).toEqual({ light: null, amount: .5 })
})

it('同一次切割拆开引用方与被引用片段：两半各指同侧，与处理顺序无关，每帧取到的画面与切开前一致', () => {
  // 引用方比被引用片段晚开始，重叠多的是右半：先拆被引用片段时引用方整体先指向右半，再拆开后左半就落空。
  const target = { ...title, duration: 100 }, referrer = code('ribbon', 20, 80)
  const sequence = addLegacyVideoEditTracks({ ...createVideoEditSequence('主'), clips: [target, referrer] })
  const document = { ...createVideoEditDocument('切割'), items: [{ id: 'text', kind: 'text' as const, name: '文字' }] }; document.sequences = [sequence]
  for (const clipIds of [['title', 'ribbon'], ['ribbon', 'title']]) {
    const next = applyVideoEditTimelineEdit(document, sequence.id, { kind: 'split', clipIds, linked: false, frame: 50 })
    const halves = (kind: string): VideoEditClip[] => next.clips.filter(clip => clip.kind === kind).sort((a, b) => a.start - b.start)
    const [left, right] = halves('text'), [early, late] = halves('code')
    expect(videoEditCodeClipReferenceIds(early)).toEqual([left.id])
    expect(videoEditCodeClipReferenceIds(late)).toEqual([right.id])
    // 引用只在帧落在被引用片段范围内才有画面：切开后引用方每一帧仍取得到。
    for (const clip of [early, late]) {
      const pointed = next.clips.find(item => item.id === videoEditCodeClipReferenceIds(clip)[0])!
      expect(pointed.start <= clip.start && clip.start + clip.duration <= pointed.start + pointed.duration).toBe(true)
    }
  }
  // 互相引用的两个片段同时被切开：各半互相指向同侧。
  const a = { ...code('a', 0, 100), track: 1, code: { ...code('a', 0, 100).code!, parameters: { light: { kind: 'clip', clipId: 'b' } } } } as VideoEditClip
  const b = { ...code('b', 0, 100), code: { ...code('b', 0, 100).code!, parameters: { light: { kind: 'clip', clipId: 'a' } } } } as VideoEditClip
  const mutual = { ...sequence, clips: [a, b] }
  const split = applyVideoEditTimelineEdit({ ...document, sequences: [mutual] }, sequence.id, { kind: 'split', clipIds: ['a', 'b'], linked: false, frame: 50 })
  for (const clip of split.clips) {
    const pointed = split.clips.find(item => item.id === videoEditCodeClipReferenceIds(clip)[0])!
    expect(pointed.track).not.toBe(clip.track)
    expect(pointed.start).toBe(clip.start)
  }
})

it('覆盖切开被引用片段：两段各指同侧，只盖掉开头的片段不算切开', () => {
  const document = { ...createVideoEditDocument('覆盖'), items: [{ id: 'text', kind: 'text' as const, name: '文字' }] }
  const overwrite = (target: VideoEditClip, referrer: VideoEditClip, from: number, duration: number) => {
    const sequence = addLegacyVideoEditTracks({ ...createVideoEditSequence('主'), clips: [target, referrer] }); document.sequences = [sequence]
    const incoming = { ...title, id: 'new', track: 3, start: 0, duration }
    const trackMap = { 3: 1 }
    const next = applyVideoEditTimelineEdit(document, sequence.id, { kind: 'place', mode: 'overwrite', frame: from, trackMap, clipboard: { projectId: document.id, frameRate: sequence.frameRate, clips: [incoming], annotations: [] }, newTracks: [] })
    return next
  }
  // 引用方跨过切口没被切：改指重叠最多的右段，而不是停在左段。
  const across = overwrite({ ...title, track: 1 }, { ...code('ribbon', 0, 100), track: 2 }, 30, 30)
  const right = across.clips.find(clip => clip.kind === 'text' && clip.start === 60)!
  expect(videoEditCodeClipReferenceIds(across.clips.find(clip => clip.id === 'ribbon')!)).toEqual([right.id])
  // 引用方与被引用片段一起被切开：两段各指同侧。
  const stacked = (() => {
    const sequence = addLegacyVideoEditTracks({ ...createVideoEditSequence('主'), clips: [{ ...title, track: 1 }, { ...code('ribbon', 0, 100), track: 2 }] }); document.sequences = [sequence]
    const clips = [{ ...title, id: 'a', track: 1, start: 0, duration: 30 }, { ...title, id: 'b', track: 2, start: 0, duration: 30 }]
    return applyVideoEditTimelineEdit(document, sequence.id, { kind: 'place', mode: 'overwrite', frame: 30, clipboard: { projectId: document.id, frameRate: sequence.frameRate, clips, annotations: [] } })
  })()
  const pieces = (kind: string): VideoEditClip[] => stacked.clips.filter(clip => clip.kind === kind && clip.start !== 30).sort((a, b) => a.start - b.start)
  const [early, late] = pieces('code'), [left, later] = pieces('text')
  expect(videoEditCodeClipReferenceIds(early)).toEqual([left.id])
  expect(videoEditCodeClipReferenceIds(late)).toEqual([later.id])
  // 只盖掉开头：被引用片段保留原 ID，引用不动。
  const head = overwrite({ ...title, track: 1 }, { ...code('ribbon', 0, 100), track: 2 }, 0, 30)
  expect(videoEditCodeClipReferenceIds(head.clips.find(clip => clip.id === 'ribbon')!)).toEqual(['title'])
})

it('引用方在锁定轨道时删除被引用片段：仍然拒绝，错误说明是哪个引用', () => {
  const sequence = addLegacyVideoEditTracks({ ...createVideoEditSequence('主'), clips: [title, code('ribbon', 0, 100)] })
  sequence.tracks.find(track => track.index === 2)!.locked = true
  const before = { ...createVideoEditDocument('锁定'), items: [{ id: 'text', kind: 'text' as const, name: '文字' }] }; before.sequences = [sequence]
  const after = reconcileVideoEditTimedContent(before, { ...before, sequences: [{ ...sequence, clips: sequence.clips.filter(clip => clip.id !== 'title') }] })
  expect(() => assertVideoEditLockedTracks(before, after)).toThrow(/“标题”.*“ribbon”.*light.*解锁/)
  const moved = { ...before, sequences: [{ ...sequence, clips: sequence.clips.map(clip => clip.id === 'ribbon' ? { ...clip, start: 5 } : clip) }] }
  expect(() => assertVideoEditLockedTracks(before, moved)).toThrow('已锁定，请先解锁再编辑')
})

it('片段从序列移除后引用置空并能查出失去了哪个参数；连带移除的引用方、手动清空的参数不算', () => {
  const sequence = { ...createVideoEditSequence('主'), clips: [title, code('ribbon', 0, 100), code('gone', 0, 100)] }
  const removed = { ...sequence, clips: [code('ribbon', 0, 100)] }
  const detached = detachVideoEditRemovedCodeClipReferences(sequence, removed)
  expect(detached.clips[0].code!.parameters).toEqual({ light: null, amount: .5 })
  expect(detachVideoEditRemovedCodeClipReferences(sequence, sequence)).toBe(sequence)
  expect(videoEditLostCodeClipReferences(sequence.clips, detached.clips)).toEqual([{ clipId: 'ribbon', parameter: 'light', targetClipId: 'title' }])
  // 编辑前就悬空的旧引用被清掉：不算这次失去的。
  expect(videoEditLostCodeClipReferences([code('ribbon', 0, 100)], [{ ...code('ribbon', 0, 100), code: { definitionId: 'm', versionId: 'v', parameters: { light: null, amount: .5 } } } as VideoEditClip])).toEqual([])
  const cleared = { ...code('ribbon', 0, 100), code: { ...code('ribbon', 0, 100).code!, parameters: { light: null, amount: .5 } } } as VideoEditClip
  expect(videoEditLostCodeClipReferences(sequence.clips, [title, cleared, code('gone', 0, 100)])).toEqual([])
  const filter = { ...code('ribbon', 0, 100), kind: 'text', code: undefined, effects: [{ id: 'fx', name: '滤镜', enabled: true, amount: 1, code: { definitionId: 'm', versionId: 'v', parameters: { light: { kind: 'clip', clipId: 'title' } } } }] } as unknown as VideoEditClip
  const after = { ...filter, effects: [{ ...filter.effects![0], code: { ...filter.effects![0].code!, parameters: { light: null } } }] } as VideoEditClip
  expect(videoEditLostCodeClipReferences([title, filter], [after])).toEqual([{ clipId: 'ribbon', effectId: 'fx', parameter: 'light', targetClipId: 'title' }])
})

it('三维引用事实：隔着二维片段引用报 cross-group，同组不报；互相引用成环报一次 element-cycle', async () => {
  const { spatialElementFacts } = await import('./spatialElementFacts')
  const sequence = createVideoEditSequence('主')
  const spatial = { enabled: true } as VideoEditClip['spatial']
  const lit = { ...title, spatial }, flat = { ...base, id: 'plain', kind: 'text', name: '二维', track: 2, start: 0, duration: 100 } as VideoEditClip
  const author = { ...code('ribbon', 0, 100), track: 3, spatial }
  const enabled = (clip: VideoEditClip): boolean => clip.spatial?.enabled === true
  expect(spatialElementFacts({ ...sequence, clips: [lit, author] }, 0, [lit, author], enabled)).toEqual([])
  expect(spatialElementFacts({ ...sequence, clips: [lit, flat, author] }, 0, [lit, flat, author], enabled).map(fact => [fact.code, fact.clipIds])).toEqual([['cross-group', ['ribbon', 'title']]])
  const a = { ...author, id: 'a', track: 1, code: { ...author.code!, parameters: { light: { kind: 'clip', clipId: 'b' } } } } as VideoEditClip
  const b = { ...author, id: 'b', track: 1, code: { ...author.code!, parameters: { light: { kind: 'clip', clipId: 'a' } } } } as VideoEditClip
  expect(spatialElementFacts({ ...sequence, clips: [a, b] }, 0, [a, b], enabled).map(fact => fact.code)).toEqual(['element-cycle'])
  // 引用的片段这一帧不在画面里：作者拿到空画面，要说出来。
  expect(spatialElementFacts({ ...sequence, clips: [{ ...lit, start: 200 }, author] }, 0, [author], enabled).map(fact => [fact.code, fact.values.exists])).toEqual([['reference-inactive', true]])
  // 受光片段、没有灯与环境、缺省布光关掉：受光内容是黑的；有一盏灯就不报。
  const solid = { ...lit, spaceLit: true } as VideoEditClip, light = { ...base, id: 'lamp', kind: 'light', track: lit.track, start: 0, duration: 100, spatial } as VideoEditClip
  const dark = { ...sequence, clips: [solid], spaceRender: { defaultLighting: 'off' as const } }
  expect(spatialElementFacts(dark, 0, [solid], enabled).map(fact => fact.code)).toEqual(['unlit'])
  expect(spatialElementFacts({ ...dark, clips: [solid, light] }, 0, [solid, light], enabled)).toEqual([])
  // 缺省布光自动：序列里有灯（后面才亮）就不套缺省布光，这一帧没灯同样是黑的。
  expect(spatialElementFacts({ ...sequence, clips: [solid, { ...light, start: 200 }] }, 0, [solid], enabled).map(fact => fact.code)).toEqual(['unlit'])
})
