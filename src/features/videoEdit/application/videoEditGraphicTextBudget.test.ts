// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createVideoEditTestProject, closeAllVideoEdits } from './videoEditDocumentTestKit'
import { appendVideoEditItems, createVideoEditGraphicItem } from './videoEditProjectItems'
import { updateVideoEditGraphicObject } from './videoEditGraphics'
import { setVideoEditCodeParameter } from './videoEditCodeParameters'
import { undoVideoEdit } from './videoEditService'
afterEach(async () => { await closeAllVideoEdits(); uninstallHarnessNativeStorage() })
it('文字以完整画幅光栅化，长文字/大字号不再受旧独立字形纹理预算限制；非法样式仍不发布', async () => {
  installHarnessNativeStorage()
  const owner = await createVideoEditTestProject()
  const itemId = createVideoEditGraphicItem(owner.document.id, { kind: 'text' })
  const [clipId] = appendVideoEditItems(owner.document.id, [itemId], owner.activeSequenceId)
  const read = () => owner.document.sequences[0].clips.find(clip => clip.id === clipId)!.graphic!.objects[0]
  const target = { projectId: owner.document.id, sequenceId: owner.activeSequenceId, clipId, objectId: read().id }
  setVideoEditCodeParameter(target, 'text', 'W'.repeat(2000))
  const previous = read().textStyle!
  updateVideoEditGraphicObject(target, { textStyle: { ...previous, fontSize: 4096 } })
  expect(read().textStyle?.fontSize).toBe(4096)
  undoVideoEdit(owner.document.id); expect(read().textStyle?.fontSize).toBe(previous.fontSize)
  const baseline = owner.document
  expect(() => updateVideoEditGraphicObject(target, { textStyle: { ...previous, fontSize: NaN } })).toThrow()
  expect(owner.document).toBe(baseline)
})
