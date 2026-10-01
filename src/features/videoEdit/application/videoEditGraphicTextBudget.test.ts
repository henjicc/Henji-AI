// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { createVideoEditDocument, videoEditDocumentSchema } from '@/core/videoEdit/document'
import type { VideoEditDocument } from '@/core/videoEdit/document'
import { createVideoEditGraphic } from '@/core/videoEdit/graphics'
import type { CodeMaterialKeyframe } from '@/core/videoEdit/codeMaterialAnimation'
import { validateVideoEditGraphicTextBudget } from './videoEditGraphicTextBudget'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { getPlatform } from '@/platform/runtime'
import { createVideoEditProject, closeVideoEditProject, editVideoProject, listVideoEditInstances, openVideoEditProject, beginVideoEditGesture, finishVideoEditGesture, updateVideoEditPicturePosition, type VideoEditInstance } from './videoEditService'
import { appendVideoEditItems, createVideoEditGraphicItem } from './videoEditProjectItems'
import { renameVideoEditGraphicObject } from './videoEditGraphics'
import { setVideoEditCodeParameter } from './videoEditCodeParameters'
import { videoEditGraphicObjectId } from './videoEditCompositeEntities'

const files = new Map<string, string>()
let calls = 0
beforeEach(() => {
  calls = 0; files.clear(); installHarnessNativeStorage()
  vi.stubGlobal('OffscreenCanvas', class {
    getContext() {
      return { font: '', measureText(text: string) {
        calls++
        const width = text.length * Number.parseFloat(this.font) * (this.font.endsWith('monospace') ? 1.5 : 1)
        return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width }
      } }
    }
  })
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue('D:/glyph-budget.henji-video')
  vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockImplementation(async (path, value) => { files.set(path, value) })
  vi.spyOn(getPlatform().system.fs, 'readTextFile').mockImplementation(async path => files.get(path)!)
})
afterEach(async () => {
  for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id)
  vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage()
})
function point(value: CodeMaterialKeyframe['value'], sourceInUs: number, interpolation: CodeMaterialKeyframe['interpolation'] = 'hold', numerator = 0): CodeMaterialKeyframe {
  return { id: crypto.randomUUID(), sourceInUs, sourceRemainder: { numerator, denominator: 3 }, interpolation, value }
}
function document(text = '字', fontSize = 20): VideoEditDocument {
  const value = createVideoEditDocument('字形预算')
  const graphic = createVideoEditGraphic('text', 1920, 1080)
  Object.assign(graphic.objects[0].parameters, { text, fontSize })
  value.items.push({ id: 'graphic-template', name: '文字模板', kind: 'graphic', graphic })
  return value
}
async function clipFixture(): Promise<{ owner: VideoEditInstance; target: { projectId: string; sequenceId: string; clipId: string; objectId: string } }> {
  const owner = (await createVideoEditProject())!
  const item = createVideoEditGraphicItem(owner.document.id, { kind: 'text' })
  const [clipId] = appendVideoEditItems(owner.document.id, [item], owner.activeSequenceId)
  const clip = owner.document.sequences[0].clips.find(clip => clip.id === clipId)!
  return { owner, target: { projectId: owner.document.id, sequenceId: owner.activeSequenceId, clipId, objectId: clip.graphic!.objects[0].id } }
}

it('schema允许的超宽文字在模板和片段发布前拒绝，不改变工程或历史', async () => {
  const owner = (await createVideoEditProject())!; const before = owner.document; const history = owner.past.length
  const bad = videoEditDocumentSchema.parse(document('W'.repeat(2000), 512))
  expect(() => editVideoProject(owner.document.id, value => ({ ...value, items: bad.items }))).toThrow('8192')
  expect(owner.document).toBe(before); expect(owner.past).toHaveLength(history)
  const fixture = await clipFixture(); const baseline = fixture.owner.document; const past = fixture.owner.past.length
  setVideoEditCodeParameter(fixture.target, 'fontSize', 512)
  const withSize = fixture.owner.document; const withSizePast = fixture.owner.past.length
  expect(() => setVideoEditCodeParameter(fixture.target, 'text', 'W'.repeat(2000))).toThrow('8192')
  expect(fixture.owner.document).toBe(withSize); expect(fixture.owner.past).toHaveLength(withSizePast)
  expect(withSize).not.toBe(baseline); expect(withSizePast).toBe(past + 1)
})
it('公共创建和参数写入同样失败关闭，不留下新对象、部分参数或历史', async () => {
  const { owner, target } = await clipFixture(); const app = createApplicationHarness()
  const clipRef = { kind: 'video_edit.clip', id: `${target.projectId}:${target.clipId}` }
  const objectRef = { kind: 'video_edit.graphic_object', id: `${target.projectId}:${videoEditGraphicObjectId(target.clipId, target.objectId)}` }
  const before = owner.document; const history = owner.past.length
  try {
    const created = await app.call('change_application_entities', { summary: '创建文字对象', changes: [{ kind: 'create_items', entityType: 'video_edit.graphic_object', parent: clipRef, items: [{ properties: { 'video_edit.graphic_object.kind': 'text', 'video_edit.graphic_object.parameters': { text: 'W'.repeat(2000), fontSize: 512 } } }] }] }, (await app.read(clipRef)).revisions as Record<string, number>)
    expect(created.ok).toBe(false); expect(owner.document).toBe(before); expect(owner.past).toHaveLength(history)
    const result = await app.change(objectRef, { 'video_edit.graphic_object.parameters': { text: 'W'.repeat(2000), fontSize: 512 } })
    expect(result.ok).toBe(false); expect(owner.document).toBe(before); expect(owner.past).toHaveLength(history)
  } finally { app.dispose() }
})
it('合并真实源时刻检查中间关键帧及连续区间，首末合法不能掩盖中间超预算', () => {
  const value = document('字', 10); const object = value.items[0].graphic!.objects[0]
  object.curves = { text: [point('字', 0), point('W'.repeat(100), 1_000_000), point('字', 2_000_000)], fontSize: [point(10, 0, 'linear'), point(512, 1_000_000, 'ease'), point(10, 2_000_000)] }
  expect(() => validateVideoEditGraphicTextBudget(videoEditDocumentSchema.parse(value))).toThrow('8192')
  object.curves = { text: [point('W'.repeat(100), 0), point('字', 2_000_000)], fontSize: [point(10, 0, 'ease'), point(100, 2_000_000)] }
  expect(() => validateVideoEditGraphicTextBudget(videoEditDocumentSchema.parse(value))).toThrow('8192')
})
it('独立hold文字/字号合法同刻切换不把新字号用到旧文字，错开时刻仍拒绝', () => {
  const value = document(); const object = value.items[0].graphic!.objects[0]
  object.curves = { text: [point('W'.repeat(100), 0), point('字', 2_000_000, 'hold', 2)], fontSize: [point(10, 0), point(100, 2_000_000, 'hold', 2)] }
  expect(() => validateVideoEditGraphicTextBudget(videoEditDocumentSchema.parse(value))).not.toThrow()
  object.curves.fontSize[1].sourceRemainder.numerator = 1
  expect(() => validateVideoEditGraphicTextBudget(videoEditDocumentSchema.parse(value))).toThrow('8192')
})
it('正常linear/ease字号与保持字体曲线通过，实际曲线覆盖未消费的参数默认值', () => {
  const value = document('W'.repeat(2000), 512); const object = value.items[0].graphic!.objects[0]
  object.curves = { text: [point('标题', 0)], fontFamily: [point('sans-serif', 0), point('monospace', 1_000_000)], fontSize: [point(10, 0, 'linear'), point(100, 1_000_000, 'ease'), point(20, 2_000_000)] }
  expect(() => validateVideoEditGraphicTextBudget(videoEditDocumentSchema.parse(value))).not.toThrow()
})
it('字体曲线的独立微秒余数区间也参与预算，不被相同整数微秒折叠', () => {
  const value = document('W'.repeat(30), 250); const object = value.items[0].graphic!.objects[0]
  object.curves = { fontFamily: [point('sans-serif', 0), point('monospace', 1_000_000, 'hold', 1), point('sans-serif', 1_000_000, 'hold', 2)] }
  expect(() => validateVideoEditGraphicTextBudget(videoEditDocumentSchema.parse(value))).toThrow('8192')
})
it('手动曲线写入中间非法文本不发布，保留真实源余数与原有历史', async () => {
  const { owner, target } = await clipFixture(); const before = owner.document; const history = owner.past.length
  expect(() => editVideoProject(owner.document.id, value => {
    const object = value.sequences[0].clips.find(clip => clip.id === target.clipId)!.graphic!.objects[0]
    object.curves = { text: [point('字', 0), point('W'.repeat(100), 1_000_000, 'hold', 1), point('字', 2_000_000)], fontSize: [point(10, 0), point(100, 1_000_000, 'hold', 1), point(10, 2_000_000)] }
    return value
  })).toThrow('8192')
  expect(owner.document).toBe(before); expect(owner.past).toHaveLength(history)
})
it('名称、形状位置和既有画面手势复用已验证绑定，不重新测量或渲染', async () => {
  const { owner, target } = await clipFixture(); calls = 0
  renameVideoEditGraphicObject(target, '新名称')
  setVideoEditCodeParameter(target, 'x', 100)
  const gesture = beginVideoEditGesture(owner.document.id)
  updateVideoEditPicturePosition(gesture, target.sequenceId, target.clipId, { x: .1, y: .2 }); finishVideoEditGesture(gesture)
  expect(calls).toBe(0)
})
it('打开工程和新文字在缺失实际测量环境时拒绝，不安装损坏工程', async () => {
  files.set('D:/bad-glyph.henji-video', JSON.stringify(videoEditDocumentSchema.parse(document('W'.repeat(2000), 512))))
  await expect(openVideoEditProject('D:/bad-glyph.henji-video')).rejects.toThrow('8192')
  expect(listVideoEditInstances()).toEqual([])
  const owner = (await createVideoEditProject())!; const before = owner.document; const history = owner.past.length
  vi.stubGlobal('OffscreenCanvas', undefined)
  expect(() => createVideoEditGraphicItem(owner.document.id, { kind: 'text' })).toThrow('无法测量')
  expect(owner.document).toBe(before); expect(owner.past).toHaveLength(history)
})
