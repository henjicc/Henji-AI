import { expect, it } from 'vitest'
import { createVideoEditDocument, createVideoEditSequence, splitVideoEditClip, type VideoEditClip } from './document'
import { applyVideoEditTimelineEdit } from './timelineEdits'
import { remapVideoEditCodeClipReferences, videoEditCodeClipReferenceIds } from './codeClipReferences'

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

it('三维引用事实：隔着二维片段引用报 cross-group，同组不报；互相引用成环报一次 element-cycle', async () => {
  const { spatialElementFacts } = await import('./spatialElementFacts')
  const sequence = createVideoEditSequence('主')
  const spatial = { enabled: true } as VideoEditClip['spatial']
  const lit = { ...title, spatial }, flat = { ...base, id: 'plain', kind: 'text', name: '二维', track: 2, start: 0, duration: 100 } as VideoEditClip
  const author = { ...code('ribbon', 0, 100), track: 3, spatial }
  const enabled = (clip: VideoEditClip): boolean => clip.spatial?.enabled === true
  expect(spatialElementFacts(sequence, 0, [lit, author], enabled)).toEqual([])
  expect(spatialElementFacts(sequence, 0, [lit, flat, author], enabled).map(fact => [fact.code, fact.clipIds])).toEqual([['cross-group', ['ribbon', 'title']]])
  const a = { ...author, id: 'a', code: { ...author.code!, parameters: { light: { kind: 'clip', clipId: 'b' } } } } as VideoEditClip
  const b = { ...author, id: 'b', track: 4, code: { ...author.code!, parameters: { light: { kind: 'clip', clipId: 'a' } } } } as VideoEditClip
  expect(spatialElementFacts(sequence, 0, [a, b], enabled).map(fact => fact.code)).toEqual(['element-cycle'])
})
