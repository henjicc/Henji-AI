import { expect, it } from 'vitest'
import { createVideoEditDocument, type VideoEditDocument } from './document'
import { removeVideoEditItems } from './projectItems'

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
  other.sequences[0].clips = [{ id: 'clip', itemId: 'survivor', name: '独立实例', kind: 'code', code, track: 1, start: 0, duration: 30, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, brightness: 1, text: '' }]
  expect(removeVideoEditItems(other, ['image', 'code', 'other']).media).toEqual(document.media)
})
