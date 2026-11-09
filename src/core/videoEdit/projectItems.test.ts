import { createVideoEditTestDocument as createVideoEditDocument } from './testFixtures'
import { expect, it } from 'vitest'
import { type VideoEditDocument } from './document'
import { makeVideoEditItemClip, removeVideoEditCodeMaterials, removeVideoEditItems, removeVideoEditSequences } from './projectItems'
import type { VideoEditAnnotation } from './annotations'

it('未声明时长的动态作者可按放置长度创建片段，不把默认放置长度当作源上限', () => {
  const document = createVideoEditDocument('宿主放置')
  document.items = [{ id: 'code', name: '作者 JS', kind: 'code', code: { definitionId: 'effect', versionId: 'version', parameters: {} } }]
  const metadata = { name: '作者 JS', kind: 'generator' as const, mode: 'dynamic' as const, parameters: [], seed: 0 }
  const clip = makeVideoEditItemClip(document, 'code', document.sequences[0].id, { frame: 0, duration: 1800 }, () => metadata)
  expect(clip.duration).toBe(1800)
  expect(() => makeVideoEditItemClip(document, 'code', document.sequences[0].id, { frame: 0, duration: 1800 }, () => ({ ...metadata, durationSeconds: 1 }))).toThrow('源范围')
})

it('删除图片素材项保留代码图片引用，随后移除最后代码素材项回收原媒体', () => {
  const document = createVideoEditDocument('引用回收')
  document.media = [{ id: 'picture', name: '图片', kind: 'image', path: 'D:/original.png', width: 3840, height: 2160, durationSeconds: 0 }]
  const code = { definitionId: 'definition', versionId: 'version', parameters: { logo: { kind: 'image' as const, mediaId: 'picture' } } }
  document.items = [{ id: 'image', name: '图片', kind: 'image', mediaId: 'picture' }, { id: 'code', name: '代码', kind: 'code', code }]
  const first = removeVideoEditItems(document, ['image'])
  expect(first.media).toEqual(document.media)
  expect(removeVideoEditItems(first, ['code']).media).toEqual([])
  const other: VideoEditDocument = { ...document, items: [...document.items, { id: 'other', name: '另一代码', kind: 'code' as const, code }] }
  expect(removeVideoEditItems(other, ['image', 'code']).media).toEqual(document.media)
  other.items.push({ id: 'survivor', name: '无图片默认值', kind: 'code', code: { ...code, parameters: { logo: null } } })
  other.sequences[0].clips = [{ id: 'clip', itemId: 'survivor', name: '独立实例', kind: 'code', code, track: 1, start: 0, duration: 30, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '' }]
  expect(removeVideoEditItems(other, ['image', 'code', 'other']).media).toEqual(document.media)
})

const clipOf = (id: string, itemId: string, start: number) => ({ id, itemId, name: `片段${id}`, kind: 'image' as const, track: 1, start, duration: 30, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '' })
const markOf = (id: string, extra: Partial<VideoEditAnnotation>): VideoEditAnnotation => ({ id, frame: 0, space: 'composition-normalized', target: { kind: 'point', x: 0.5, y: 0.5 }, text: '看这里', status: 'open', author: { kind: 'user', name: '我' }, createdAt: '2026-11-09T00:00:00.000Z', thread: [], ...extra })

it('删除素材项连同引用它的片段与片段上的标注，范围标注只去掉被删片段', () => {
  const document = createVideoEditDocument('级联删除')
  document.media = [{ id: 'picture', name: '图片', kind: 'image', path: 'D:/a.png', width: 10, height: 10, durationSeconds: 0 }]
  document.items = [{ id: 'gone', name: '要删的图', kind: 'image', mediaId: 'picture' }, { id: 'stay', name: '留下的图', kind: 'image', mediaId: 'picture' }]
  document.sequences[0].clips = [clipOf('a', 'gone', 0), clipOf('b', 'stay', 30)]
  document.sequences[0].annotations = [markOf('on-a', { clipId: 'a' }), markOf('range-ab', { target: { kind: 'range', startFrame: 0, endFrame: 60, clipIds: ['a', 'b'] } }), markOf('range-a', { target: { kind: 'range', startFrame: 0, endFrame: 30, clipIds: ['a'] } }), markOf('free', {})]
  const next = removeVideoEditItems(document, ['gone'])
  expect(next.items.map(item => item.id)).toEqual(['stay'])
  expect(next.sequences[0].clips.map(clip => clip.id)).toEqual(['b'])
  expect(next.sequences[0].annotations.map(mark => mark.id)).toEqual(['range-ab', 'free'])
  expect(next.sequences[0].annotations[0].target).toMatchObject({ clipIds: ['b'] })
  expect(next.media).toEqual(document.media)
})

it('删除序列连同其内容；仍被嵌套序列素材项引用时拒绝并列出素材项与使用它的序列', () => {
  const document = createVideoEditDocument('删除序列')
  const parent = document.sequences[0]
  const child = { ...structuredClone(parent), id: 'child', name: '子序列', clips: [clipOf('c', 'img', 0)], annotations: [markOf('m', { clipId: 'c' })] }
  document.items = [{ id: 'img', name: '图', kind: 'image', mediaId: 'picture' }]
  document.media = [{ id: 'picture', name: '图片', kind: 'image', path: 'D:/a.png', width: 10, height: 10, durationSeconds: 0 }]
  document.sequences = [parent, child]
  expect(removeVideoEditSequences(document, ['child']).sequences.map(sequence => sequence.id)).toEqual([parent.id])
  document.items.push({ id: 'nest', name: '嵌套子序列', kind: 'sequence', sequenceId: 'child' })
  parent.clips = [{ ...clipOf('n', 'nest', 0), kind: 'sequence' as const }]
  expect(() => removeVideoEditSequences(document, ['child'])).toThrow(/“嵌套子序列”.*“[^”]+”/)
  expect(() => removeVideoEditSequences(document, ['missing'])).toThrow('目标序列不存在')
})

it('代码素材仍被引用时拒绝并列出引用它的素材项与片段', () => {
  const document = createVideoEditDocument('代码引用')
  const code = { definitionId: 'definition', versionId: 'version', parameters: {} }
  document.items = [{ id: 'code', name: '光效', kind: 'code', code }]
  document.sequences[0].clips = [{ ...clipOf('k', 'code', 0), name: '光效片段', kind: 'code' as const, code }]
  expect(() => removeVideoEditCodeMaterials(document, ['definition'])).toThrow(/素材项“光效”.*片段“光效片段”/)
  const cleared = removeVideoEditItems(document, ['code'])
  expect(cleared.sequences[0].clips).toEqual([])
  expect(() => removeVideoEditCodeMaterials(cleared, ['definition'])).not.toThrow()
})
