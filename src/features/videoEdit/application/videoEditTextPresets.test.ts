// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defaultVideoEditTextStyle } from '@/core/videoEdit/text'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { createVideoEditTestProject, closeAllVideoEdits } from './videoEditDocumentTestKit'
import { videoEditTextPresetLibrary } from './videoEditTextPresets'
import { applyTitleTemplate } from './videoEditTitleTemplates'
import { videoEditGraphicObjectId } from './videoEditCompositeEntities'
import { undoVideoEdit } from './videoEditService'
beforeEach(() => { installHarnessNativeStorage(); videoEditTextPresetLibrary.replace([]) })
afterEach(async () => { await closeAllVideoEdits(); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })
it('助手通用实体创建/读回/改名/改样式/删除预设，应用图形样式同源并一步撤销', async () => {
  const owner = await createVideoEditTestProject(); const parent = { kind: 'video_edit.document', id: owner.document.id }; const app = createApplicationHarness()
  const style = { ...defaultVideoEditTextStyle(1080), tracking: 120, leading: 98, baselineShift: 6, tsume: 4, fauxBold: true, strokes: [{ enabled: true, color: defaultVideoEditTextStyle(1080).fill.color, width: 3, position: 'inside' as const }], shadows: [{ enabled: true, color: defaultVideoEditTextStyle(1080).background.color, opacity: .4, angle: 90, distance: 8, size: 2, blur: 4 }] }
  try {
    await app.requireResult('change_application_entities', { summary: '保存文字样式', changes: [{ kind: 'create_items', entityType: 'video_edit.text_preset', parent, items: [{ properties: { 'video_edit.text_preset.name': '电影', 'video_edit.text_preset.style': style } }] }] })
    const preset = videoEditTextPresetLibrary.list()[0]; const ref = { kind: 'video_edit.text_preset', id: preset.id }
    expect((await app.read(ref, ['video_edit.text_preset.name', 'video_edit.text_preset.style'])).properties).toMatchObject({ 'video_edit.text_preset.name': '电影', 'video_edit.text_preset.style': style })
    const renamed = await app.change(ref, { 'video_edit.text_preset.name': '片头', 'video_edit.text_preset.style': { ...style, allCaps: true } }); expect(renamed.ok, JSON.stringify(renamed)).toBe(true)
    expect(videoEditTextPresetLibrary.list()[0]).toMatchObject({ name: '片头', style: { allCaps: true } })
    const [clipId] = applyTitleTemplate(parent.id, owner.activeSequenceId, 'title:chapter')
    const object = owner.document.sequences[0].clips.find(clip => clip.id === clipId)!.graphic!.objects.find(value => value.kind === 'text')!
    const target = { kind: 'video_edit.graphic_object', id: `${parent.id}:${videoEditGraphicObjectId(clipId, object.id)}` }
    const previous = structuredClone(object.textStyle); const history = owner.past.length
    expect(await app.change(target, { 'video_edit.graphic_object.text_style': style, 'video_edit.graphic_object.visible': false })).toMatchObject({ ok: true })
    expect((await app.read(target, ['video_edit.graphic_object.text_style', 'video_edit.graphic_object.visible'])).properties).toMatchObject({ 'video_edit.graphic_object.text_style': style, 'video_edit.graphic_object.visible': false })
    expect(owner.past).toHaveLength(history + 1); undoVideoEdit(parent.id)
    expect(owner.document.sequences[0].clips.find(clip => clip.id === clipId)!.graphic!.objects.find(value => value.id === object.id)?.textStyle).toEqual(previous)
    const baseline = await app.read(ref, ['video_edit.text_preset.name', 'video_edit.text_preset.style'])
    await app.requireResult('change_application_entities', { summary: '删除文字样式', changes: [{ kind: 'remove_items', entityType: ref.kind, parent, targets: [ref] }] }, baseline.revisions as Record<string, number>)
    expect(videoEditTextPresetLibrary.list()).toEqual([])
  } finally { app.dispose() }
})
