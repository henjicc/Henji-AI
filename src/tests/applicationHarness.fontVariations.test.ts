// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createApplicationHarness } from './applicationHarness'
import { installHarnessNativeStorage, seedHarnessFonts, uninstallHarnessNativeStorage } from './harnessNativeStorage'
import { createVideoEditTestProject, closeAllVideoEdits } from '@/features/videoEdit/application/videoEditDocumentTestKit'
import { editVideoProject, requireVideoEditInstance } from '@/features/videoEdit/application/videoEditService'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { defaultVideoEditTextStyle } from '@/core/videoEdit/text'
import { evaluateVideoEditClip } from '@/core/videoEdit/keyframes'
import { GENERIC_FONT_FACES } from '@/core/fonts/catalog'
import { loadFontLibrary } from '@/platform/fonts'

const disposers: Array<() => void> = []
beforeEach(() => { installHarnessNativeStorage() })
afterEach(async () => { disposers.splice(0).forEach(dispose => dispose()); await closeAllVideoEdits(); uninstallHarnessNativeStorage() })

it('助手经通用实体读到字体的轴，写入轴数值与字重关键帧后读回一致，渲染求值按时间插值', async () => {
  const axes = [{ tag: 'wght', name: 'Weight', min: 100, default: 400, max: 900 }]
  seedHarnessFonts({ revision: 1, faces: [{ ...GENERIC_FONT_FACES[0], id: 'v'.repeat(64), family: 'Variable Sans', localizedFamily: '可变黑体', fullName: 'Variable Sans Regular', aliases: [], axes }] })
  await loadFontLibrary(true)
  const owner = await createVideoEditTestProject()
  const sequenceId = owner.document.sequences[0].id
  editVideoProject(owner.document.id, document => {
    document = structuredClone(document)
    document.items.push({ id: 'title-item', name: '标题', kind: 'text' })
    const clip = Object.assign(makeVideoEditItemClip(document, 'title-item', sequenceId, { frame: 0, duration: 60 }), { id: 'title', text: '字重', textStyle: { ...defaultVideoEditTextStyle(1080), fontFamily: 'Variable Sans' } })
    document.sequences[0].clips.push(clip)
    return document
  })
  const app = createApplicationHarness(); disposers.push(app.dispose)

  const font = await app.read({ kind: 'font', id: 'v'.repeat(64) }, ['font.axes'])
  expect(font).toMatchObject({ properties: { 'font.axes': axes } })

  const clipRef = { kind: 'video_edit.clip', id: `${owner.document.id}:title` }
  const style = { ...defaultVideoEditTextStyle(1080), fontFamily: 'Variable Sans', fontVariations: { wght: 350 } }
  const keyframes = { wght: [{ time: 0, value: 200, interpolation: 'linear' }, { time: 40, value: 800, interpolation: 'linear' }] }
  const result = await app.change(clipRef, { 'video_edit.clip.text_style': style, 'video_edit.clip.font_variation_keyframes': keyframes })
  expect(result.ok, JSON.stringify(result)).toBe(true)
  const snapshot = await app.read(clipRef, ['video_edit.clip.text_style', 'video_edit.clip.font_variation_keyframes'])
  expect(snapshot).toMatchObject({ properties: { 'video_edit.clip.text_style': { fontVariations: { wght: 350 } }, 'video_edit.clip.font_variation_keyframes': keyframes } })

  const clip = requireVideoEditInstance(owner.document.id).document.sequences[0].clips.find(value => value.id === 'title')!
  expect(evaluateVideoEditClip(clip, 20).textStyle?.fontVariations).toEqual({ wght: 500 })

  const cleared = await app.change(clipRef, { 'video_edit.clip.font_variation_keyframes': {} })
  expect(cleared.ok, JSON.stringify(cleared)).toBe(true)
  const after = requireVideoEditInstance(owner.document.id).document.sequences[0].clips.find(value => value.id === 'title')!
  expect(evaluateVideoEditClip(after, 20).textStyle?.fontVariations).toEqual({ wght: 350 })
})
