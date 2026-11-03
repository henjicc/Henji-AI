import { expect, it } from 'vitest'
import { createVideoEditDocument, createVideoEditSequence, videoEditComposition, type VideoEditClip } from './document'
import { addLegacyVideoEditTracks } from './testFixtures'
import { codeMediaInputComposition } from './codeMediaInput'
import { codeImageReference } from './codeMaterial/contract'
import { codeMaterialImageReferenceSchema } from './codeMaterial/parameterValueSchema'

it('图片参数引用时间线片段：只合成被引用的片段且关掉它的空间；引用自身或片段不在此刻时没有这个输入', () => {
  const document = createVideoEditDocument('引用片段'), sequence = createVideoEditSequence('主'); addLegacyVideoEditTracks(sequence); document.sequences = [sequence]
  const base = { sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 0, text: '' }
  const title = { ...base, id: 'title', itemId: 'text', kind: 'text', name: '标题', track: 2, start: 10, duration: 20, text: '痕迹', spatial: { enabled: true }, depth: .3 } as VideoEditClip
  const code = { ...base, id: 'ribbons', itemId: 'text', kind: 'text', name: '光带', track: 3, start: 0, duration: 60 } as VideoEditClip
  sequence.clips = [title, code]
  document.items = [{ id: 'text', kind: 'text', name: '文字' }]
  const composition = videoEditComposition(document, sequence.id)
  const reference = codeImageReference({ kind: 'clip', clipId: 'title' }, '光源')
  expect(codeMaterialImageReferenceSchema.parse(reference)).toEqual({ kind: 'clip', clipId: 'title' })
  const input = codeMediaInputComposition(composition, code, reference, 15)!
  expect(input.kind).toBe('sequence')
  expect(input.document.clips.map(clip => clip.id)).toEqual(['title'])
  expect(input.document.clips[0].spatial).toBeUndefined()
  expect(input.document.clips[0].depth).toBe(.3)
  expect(codeMediaInputComposition(composition, code, reference, 40)).toBeUndefined()
  expect(codeMediaInputComposition(composition, title, reference, 15)).toBeUndefined()
  expect(() => codeImageReference({ kind: 'clip', clipId: 'title', mediaId: 'x' }, '光源')).toThrow('引用片段')
})
