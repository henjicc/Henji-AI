// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
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
