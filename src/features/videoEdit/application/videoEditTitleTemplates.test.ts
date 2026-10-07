// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { createVideoEditProject, editVideoSequence, undoVideoEdit } from './videoEditService'
import { closeAllVideoEdits, savedVideoEdit } from './videoEditDocumentTestKit'
import { createTitleTemplateLibrary, TITLE_TEMPLATE_STORAGE_KEY, useTitleTemplateLibrary } from './videoEditTitleTemplateLibrary'
import { applyTitleTemplate, editTitleTemplateSelection, saveTitleTemplateSelection, writeTitleTemplateDrag } from './videoEditTitleTemplates'
import { acceptsVideoEditDrop, readVideoEditDrop, dropVideoEditInput } from './videoEditDrop'

beforeEach(() => { installHarnessNativeStorage(); localStorage.removeItem(TITLE_TEMPLATE_STORAGE_KEY); useTitleTemplateLibrary.setState({ templates: [], error: '' }); vi.stubGlobal('OffscreenCanvas', class { getContext() { return { font: '', measureText(text: string) { return { width: text.length * 20, actualBoundingBoxLeft: 0, actualBoundingBoxRight: text.length * 20 } } } } }) })
afterEach(async () => { await closeAllVideoEdits(); vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage() })
it('时间线拖入模板含素材项与动画，只占一步撤销；锁轨/音轨拒绝不留部分写入', async () => {
  const owner = await createVideoEditProject(); const sequenceId = owner.activeSequenceId; const projectId = owner.document.id
  const data = new Map<string, string>(); const transfer = { get types() { return [...data.keys()] }, setData(key: string, value: string) { data.set(key, value) }, getData: (key: string) => data.get(key) ?? '' } as unknown as DataTransfer
  writeTitleTemplateDrag(transfer, 'title:lower_third'); expect(acceptsVideoEditDrop(transfer)).toBe(true)
  const history = owner.past.length; const before = structuredClone(owner.document)
  const ids = await dropVideoEditInput(projectId, readVideoEditDrop(transfer), { frame: 90, track: 1 }, undefined, { sequenceId })
  expect(ids).toHaveLength(1); expect(owner.document.sequences[0].clips[0]).toMatchObject({ start: 90, kind: 'graphic' }); expect(owner.past.length).toBe(history + 1)
  undoVideoEdit(projectId); expect(owner.document.items).toEqual(before.items); expect(owner.document.sequences[0].clips).toEqual(before.sequences[0].clips)
  expect(() => applyTitleTemplate(projectId, sequenceId, 'title:title_card', {}, { frame: 0, track: 0 })).toThrow('视频')
  editVideoSequence(projectId, sequenceId, sequence => ({ ...sequence, tracks: sequence.tracks.map(track => ({ ...track, locked: true })) }))
  const baseline = owner.document; expect(() => applyTitleTemplate(projectId, sequenceId, 'title:chapter')).toThrow('视频'); expect(owner.document).toBe(baseline)
})
it('另存组合并编辑文字/颜色/时长一步撤销，模板存储独立；磁盘失败不发布', async () => {
  const owner = await createVideoEditProject(); const projectId = owner.document.id; const sequenceId = owner.activeSequenceId
  const ids = applyTitleTemplate(projectId, sequenceId, 'title:lower_third'); const saved = saveTitleTemplateSelection(projectId, sequenceId, ids, '我的人名条')
  expect(createTitleTemplateLibrary().getState().templates[0].id).toBe(saved.id)
  const original = structuredClone(owner.document); const history = owner.past.length
  editTitleTemplateSelection(projectId, sequenceId, ids, { text: '张三', subtitle: '导演', durationSeconds: 8 })
  expect(owner.document.sequences[0].clips[0].graphic?.objects.map(object => object.id)).toEqual(original.sequences[0].clips[0].graphic?.objects.map(object => object.id))
  expect(owner.document.sequences[0].clips[0].duration).toBe(240); expect(owner.past.length).toBe(history + 1)
  undoVideoEdit(projectId); expect(owner.document.sequences).toEqual(original.sequences)
  const storage = { getItem: () => null, setItem: () => { throw new Error('disk') } }; const library = createTitleTemplateLibrary(storage)
  expect(() => library.getState().replace([saved])).toThrow('disk'); expect(library.getState().templates).toEqual([])
  const corrupted = createTitleTemplateLibrary({ getItem: () => 'broken', setItem: vi.fn() }); expect(corrupted.getState().error).toBeTruthy(); expect(() => corrupted.getState().replace([saved])).toThrow('读取失败')
})
it('多层用户模板落在现有画面上方；轨道空位与新增轨道不改变已有音轨，整组撤销', async () => {
  const owner = await createVideoEditProject(); const projectId = owner.document.id; const sequenceId = owner.activeSequenceId
  const first = applyTitleTemplate(projectId, sequenceId, 'title:lower_third')
  const second = applyTitleTemplate(projectId, sequenceId, 'title:callout')
  const template = saveTitleTemplateSelection(projectId, sequenceId, [...first, ...second], '多层标题')
  const before = structuredClone(owner.document); const history = owner.past.length
  const added = applyTitleTemplate(projectId, sequenceId, template, {}, { frame: 0, newTrack: 'video' })
  const clips = owner.document.sequences[0].clips.filter(clip => added.includes(clip.id))
  expect(clips).toHaveLength(2); expect(new Set(clips.map(clip => clip.track)).size).toBe(2)
  expect(Math.min(...clips.map(clip => clip.track))).toBeGreaterThan(Math.max(...before.sequences[0].clips.map(clip => clip.track)))
  expect(owner.document.sequences[0].tracks.filter(track => track.kind === 'audio')).toEqual(before.sequences[0].tracks.filter(track => track.kind === 'audio'))
  expect(owner.past.length).toBe(history + 1)
  undoVideoEdit(projectId); expect(owner.document.sequences).toEqual(before.sequences); expect(owner.document.items).toEqual(before.items)
})
it('公共入口列出/读取模板，应用按文件核实，通用集合创建删除本机模板并拒绝删除内置项', async () => {
  const owner = await createVideoEditProject(); const id = owner.document.id; const app = createApplicationHarness()
  try {
    const listed = await app.requireResult('list_application_entities', { entityType: 'video_edit.title_template', limit: 20 }); expect(listed.refs).toHaveLength(6)
    const read = await app.read({ kind: 'video_edit.title_template', id: 'title:chapter' }, ['video_edit.title_template.definition']); expect(read.properties).toHaveProperty('video_edit.title_template.definition')
    const outcome = await app.requireResult('apply_video_edit_title_template', { documentRef: { kind: 'video_edit.document', id }, sequenceRef: { kind: 'video_edit.sequence', id: `${id}:${owner.activeSequenceId}` }, frame: 12, templateRef: { kind: 'video_edit.title_template', id: 'title:chapter' }, parameters: { text: '第二章' } })
    expect(outcome.verified).toBe(true); expect(savedVideoEdit(id).sequences[0].clips).toHaveLength(1)
    await app.requireResult('change_application_entities', { summary: '保存标题', changes: [{ kind: 'create_items', entityType: 'video_edit.title_template', parent: { kind: 'video_edit.document', id }, items: [{ properties: { 'video_edit.title_template.name': '章节副本', 'video_edit.title_template.definition': (read.properties as Record<string, unknown>)['video_edit.title_template.definition'] } }] }] })
    expect(useTitleTemplateLibrary.getState().templates).toHaveLength(1)
    const ref = { kind: 'video_edit.title_template', id: useTitleTemplateLibrary.getState().templates[0].id }
    const state = await app.read(ref)
    await app.requireResult('change_application_entities', { summary: '删除标题', changes: [{ kind: 'remove_items', entityType: ref.kind, parent: { kind: 'video_edit.document', id }, targets: [ref] }] }, state.revisions as Record<string, number>)
    expect(useTitleTemplateLibrary.getState().templates).toHaveLength(0)
    const builtin = await app.read({ kind: 'video_edit.title_template', id: 'title:chapter' })
    expect((await app.call('change_application_entities', { summary: '内置模板固定', changes: [{ kind: 'remove_items', entityType: ref.kind, parent: { kind: 'video_edit.document', id }, targets: [{ kind: ref.kind, id: 'title:chapter' }] }] }, builtin.revisions as Record<string, number>)).ok).toBe(false)
  } finally { app.dispose() }
})
