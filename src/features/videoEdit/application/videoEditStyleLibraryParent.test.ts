// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { getPlatform } from '@/platform/runtime'
import { VideoEditStyleCollectionExecutor } from './videoEditStyleReflection'
import { listDeleted } from '@/services/recycle'
import { listVideoEditInstances } from './videoEditService'
import { videoEditStyleLibrary } from './videoEditStyleLibrary'
import { createTestStyleLibraryIo } from './videoEditStyleTestKit'

const library = { kind: 'video_edit.style_library', id: 'singleton' }
const body = { kind: 'code', code: { entry: 'index.js', files: { 'index.js': 'export default { name: "人名条", kind: "generator", mode: "dynamic", params: [], layers() { return [] } }\n' } } }
let io: ReturnType<typeof createTestStyleLibraryIo>
beforeEach(() => { installHarnessNativeStorage(); io = createTestStyleLibraryIo({ builtin: false }); videoEditStyleLibrary.reset(io, undefined) })
afterEach(() => { uninstallHarnessNativeStorage(); io.dispose() })

it('没有打开任何剪辑：以风格库为父对象新建风格与库模板，可撤销，也可删除', async () => {
  const app = createApplicationHarness()
  try {
    expect(listVideoEditInstances()).toEqual([])
    const created = await app.requireResult('change_application_entities', { summary: '新建风格与模板', changes: [
      { kind: 'create_items', entityType: 'video_edit.style', parent: library, items: [{ properties: { 'video_edit.style.name': '节点光迹' } }] },
      { kind: 'create_items', entityType: 'video_edit.template', parent: library, items: [{ properties: { 'video_edit.template.name': '档案人名条', 'video_edit.template.body': body } }] },
    ] }) as { resultRefs: Array<{ kind: string; id: string }>; undoRef: string }
    const style = created.resultRefs.find(value => value.kind === 'video_edit.style')!
    const template = created.resultRefs.find(value => value.kind === 'video_edit.template')!
    expect(videoEditStyleLibrary.requireStyle(style.id).style.name).toBe('节点光迹')
    expect(videoEditStyleLibrary.requireTemplate(template.id).template.name).toBe('档案人名条')
    expect((await app.read(library, ['video_edit.style_library.style_count', 'video_edit.style_library.template_count', 'video_edit.style_library.default_style_id'])).properties).toMatchObject({ 'video_edit.style_library.style_count': 1, 'video_edit.style_library.template_count': 1, 'video_edit.style_library.default_style_id': null })
    // 撤销只恢复风格库记录，同样不需要打开剪辑。
    await app.requireResult('undo_application_changes', { undoRef: created.undoRef })
    expect(videoEditStyleLibrary.findStyle(style.id)).toBeUndefined()
    expect(videoEditStyleLibrary.findTemplate(template.id)).toBeUndefined()

    const again = await app.requireResult('change_application_entities', { summary: '再建风格', changes: [{ kind: 'create_items', entityType: 'video_edit.style', parent: library, items: [{ properties: { 'video_edit.style.name': '克制' } }] }] }) as { resultRefs: Array<{ kind: string; id: string }> }
    const ref = again.resultRefs.find(value => value.kind === 'video_edit.style')!
    await app.requireResult('change_application_entities', { summary: '删除风格', changes: [{ kind: 'remove_items', entityType: 'video_edit.style', parent: library, targets: [ref] }] }, (await app.read(ref, ['video_edit.style.name'])).revisions as Record<string, number>)
    expect(videoEditStyleLibrary.findStyle(ref.id)).toBeUndefined()
    expect(listVideoEditInstances()).toEqual([])
  } finally { app.dispose() }
})

it('父对象不对时写入前拒绝，并指向风格库单例', async () => {
  const app = createApplicationHarness()
  try {
    for (const parent of [{ kind: 'video_edit.document', id: 'not-open' }, { kind: 'video_edit.sequence', id: 'x:y' }, { kind: 'video_edit.style_library', id: 'other' }]) {
      const result = await app.call('change_application_entities', { summary: '新建风格', changes: [{ kind: 'create_items', entityType: 'video_edit.style', parent, items: [{ properties: { 'video_edit.style.name': '节点光迹' } }] }] })
      expect(result.ok).toBe(false)
      expect(JSON.stringify(result)).toContain('video_edit.style_library:singleton')
    }
    expect(videoEditStyleLibrary.listStyles()).toEqual([])
  } finally { app.dispose() }
})

it('助手删除风格后撤销，经通用回收恢复全部媒体；普通保存不增加回收项', async () => {
  const app = createApplicationHarness()
  try {
    const created = await app.requireResult('change_application_entities', { summary: '新建风格', changes: [{ kind: 'create_items', entityType: 'video_edit.style', parent: library, items: [{ properties: { 'video_edit.style.name': '带样片' } }] }] }) as { resultRefs: Array<{ kind: string; id: string }> }
    const ref = created.resultRefs[0], entry = videoEditStyleLibrary.requireStyle(ref.id)
    const media = { preview: new Uint8Array([1, 2]), thumbnail: new Uint8Array([3]), anchors: [new Uint8Array([4]), new Uint8Array([5])] }
    await videoEditStyleLibrary.saveStyle(entry.style, media)
    await videoEditStyleLibrary.saveStyle({ ...entry.style, description: '普通编辑' })
    expect(await listDeleted()).toEqual([])
    const removed = await app.requireResult('change_application_entities', { summary: '删除风格', changes: [{ kind: 'remove_items', entityType: 'video_edit.style', parent: library, targets: [ref] }] }, (await app.read(ref, ['video_edit.style.name'])).revisions as Record<string, number>) as { undoRef: string }
    expect(videoEditStyleLibrary.findStyle(ref.id)).toBeUndefined()
    await app.requireResult('undo_application_changes', { undoRef: removed.undoRef })
    expect(await videoEditStyleLibrary.readStyleMedia(ref.id)).toEqual(media)
    expect(videoEditStyleLibrary.requireStyle(ref.id).style.description).toBe('普通编辑')
  } finally { app.dispose() }
})

it('批量模板删除的撤销中途失败后，只重试尚未恢复的回收项', async () => {
  const app = createApplicationHarness()
  try {
    const created = await app.requireResult('change_application_entities', { summary: '新建模板', changes: [{ kind: 'create_items', entityType: 'video_edit.template', parent: library,
      items: ['甲', '乙'].map(name => ({ properties: { 'video_edit.template.name': name, 'video_edit.template.body': body } })) }] }) as { resultRefs: Array<{ kind: string; id: string }> }
    const executor = new VideoEditStyleCollectionExecutor('video_edit.template')
    const removed = await executor.apply({ kind: 'collection', parent: library, entityType: 'video_edit.template', expectedRevisions: {}, operation: { kind: 'remove', targets: created.resultRefs } },
      { requestId: 'remove-templates', exposure: 'assistant', acceptedDataClasses: new Set() })
    const settings = getPlatform().settings, restore = settings.restoreDeleted.bind(settings)
    const spy = vi.spyOn(settings, 'restoreDeleted').mockImplementationOnce(restore).mockRejectedValueOnce(new Error('文件占用'))
    try {
      await expect(executor.undo(removed.undoToken!)).rejects.toThrow('文件占用')
      expect(videoEditStyleLibrary.listTemplates()).toHaveLength(1)
      await executor.undo(removed.undoToken!)
      expect(new Set(videoEditStyleLibrary.listTemplates().map(entry => entry.template.name))).toEqual(new Set(['甲', '乙']))
      expect(spy).toHaveBeenCalledTimes(3)
    } finally { spy.mockRestore() }
  } finally { app.dispose() }
})
