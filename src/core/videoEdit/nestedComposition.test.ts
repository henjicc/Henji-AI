import { expect, it } from 'vitest'
import { createVideoEditDocument, createVideoEditSequence, videoEditComposition, videoEditNestedComposition } from './document'

it('子序列只共享项目资源，不继承父级字幕、标记、转场或音画设置；嵌套和多机位共用边界', () => {
  const document = createVideoEditDocument('测试'), parent = createVideoEditSequence('父级'), child = createVideoEditSequence('屏幕')
  parent.captions = [{ id: 'caption', start: 0, duration: 60, text: '只出现一次' }]
  parent.markers = [{ id: 'marker', frame: 120, name: '父级章节' }]
  parent.transitions = []; child.width = 1080; child.height = 1920
  parent.textTranscription = { audioDocumentId: 'parent-recognition', sources: [] }
  parent.captionTrackEnabled = false; parent.captionTrackLocked = true
  parent.styleKitId = 'parent-style'; parent.binId = 'parent-bin'; parent.label = 'blue'
  document.styleKits = []; document.colorLuts = []; document.codeMaterials = []
  document.sequences = [parent, child]
  document.items = [{ id: 'nested', kind: 'sequence', sequenceId: child.id, name: '屏幕' }]
  const result = videoEditNestedComposition(videoEditComposition(document, parent.id), { kind: 'sequence', itemId: 'nested' })!
  expect(result).toEqual(videoEditComposition(document, child.id))
  expect(result.captions).toBeUndefined(); expect(result.markers).toBeUndefined(); expect(result.transitions).toBeUndefined()
  expect(result.media).toBe(document.media); expect(result.items).toBe(document.items)
  expect(result.styleKits).toBe(document.styleKits); expect(result.colorLuts).toBe(document.colorLuts); expect(result.codeMaterials).toBe(document.codeMaterials)
  expect(result.textTranscription).toBeUndefined(); expect(result.captionTrackEnabled).toBeUndefined(); expect(result.captionTrackLocked).toBeUndefined()
  expect(result.styleKitId).toBeUndefined(); expect(result.binId).toBeUndefined(); expect(result.label).toBeUndefined()
  child.captions = [{ id: 'child-caption', start: 20, duration: 40, text: '自己的字幕' }]
  expect(videoEditNestedComposition(videoEditComposition(document, parent.id), { kind: 'sequence', itemId: 'nested' })?.captions).toEqual(child.captions)
})
