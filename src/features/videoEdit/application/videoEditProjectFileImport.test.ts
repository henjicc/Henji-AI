import { createVideoEditTestProject as createVideoEditProject } from './videoEditDocumentTestKit'
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { join, resolve, sep } from 'node:path'
import { getPlatform } from '@/platform/runtime'
import type { ResolveProjectFilesRequest, ResolveProjectFilesResult } from '@/platform/contracts/documents'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { useSettingsStore } from '@/stores/settingsStore'
import { closeVideoEditProject, editVideoProject, listVideoEditInstances, undoVideoEdit } from './videoEditService'
import { videoEditNativeMediaProbe } from './videoEditMediaProbe'

vi.mock('mediabunny', () => ({
  ALL_FORMATS: [], UrlSource: class {},
  Input: class {
    async getPrimaryVideoTrack() { return { codec: null, displayWidth: 1920, displayHeight: 1080, canDecode: async () => true, computeFrameRateMetrics: async () => ({ probedPacketCount: 256, bestGuessFrameRate: 30, frameRateIsConstant: true }) } }
    async getPrimaryAudioTrack() { return null }
    async getAudioTracks() { return [] }
    async computeDuration() { return 2 }
    dispose() {}
  },
}))

// 主进程按真实路径解析后的项目文件夹；目录读取替身按 boundary 标出指向项目外的联接点。
const root = resolve(sep, 'projects', '演示项目')
const at = (...parts: string[]): string => join(root, ...parts)
const tree: Record<string, Array<{ name: string; isDirectory: boolean; outside?: boolean }>> = {
  [at('素材', '录屏')]: [{ name: 'a.mp4', isDirectory: false }, { name: 'notes.txt', isDirectory: false }, { name: '外链', isDirectory: true, outside: true }, { name: '坏.mp4', isDirectory: false }],
}
const files: Record<string, string> = {
  '素材/截图/产品主页.png': at('素材', '截图', '产品主页.png'),
  '素材/录屏': at('素材', '录屏'),
  '素材/说明.txt': at('素材', '说明.txt'),
  '素材/坏掉.mp4': at('素材', '坏掉.mp4'),
}
function resolution(request: ResolveProjectFilesRequest): ResolveProjectFilesResult {
  return { root, entries: request.paths.map(input => {
    if (input.startsWith('..') || input.includes(':')) return { input, status: 'rejected' as const, reason: input.startsWith('..') ? 'parent_segment' as const : 'absolute_path' as const, message: `“${input}”不在项目文件夹里。` }
    const path = files[input]
    if (!path) return { input, status: 'rejected' as const, reason: 'not_found' as const, message: `“${input}”在项目文件夹里不存在。` }
    return { input, status: 'resolved' as const, relativePath: input, path, kind: tree[path] ? 'directory' as const : 'file' as const }
  }) }
}

beforeEach(() => {
  useSettingsStore.getState().setVideoEditImportFolderBins(true)
  useSettingsStore.getState().setVideoEditDuplicatePolicy('skip')
  installHarnessNativeStorage()
  vi.spyOn(getPlatform().assetLibrary, 'inspectFileContent').mockResolvedValue({ sizeBytes: 4096, fileModifiedAt: 1000, contentIdentity: 'a'.repeat(64) })
  vi.spyOn(getPlatform().system.paths, 'dirname').mockResolvedValue(root)
  vi.spyOn(getPlatform().media, 'allowRoot').mockResolvedValue(undefined)
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Blob(['png'])))
  vi.stubGlobal('createImageBitmap', async () => ({ width: 800, height: 600, close() {} }))
  vi.spyOn(getPlatform().system.fs, 'readDirPage').mockImplementation(async (path, options) => {
    if (options?.close) return { entries: [], realPath: path }
    if (!tree[path]) throw new Error('ENOTDIR')
    return { realPath: path, entries: tree[path].map(({ outside, ...entry }) => ({ ...entry, ...(outside && options?.boundary ? { outside } : {}) })) }
  })
  // 坏.mp4 与 坏掉.mp4 读不出：探测失败按跳过汇总，不让整次导入失败
  vi.spyOn(getPlatform().system.fs, 'exists').mockImplementation(async path => !path.includes('坏'))
  vi.spyOn(videoEditNativeMediaProbe, 'forcedBackend').mockResolvedValue('browser')
})
afterEach(async () => { for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id); vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage() })

it('按项目内相对路径导入文件与文件夹：主进程解析、以项目为边界递归，回执列出素材项、媒体与跳过原因，一步撤销', async () => {
  const owner = await createVideoEditProject(); const id = owner.document.id; const history = owner.past.length
  const resolve = vi.spyOn(getPlatform().documents, 'resolveProjectFiles').mockImplementation(async request => resolution(request))
  const app = createApplicationHarness()
  try {
    const paths = ['素材/截图/产品主页.png', '素材/录屏', '素材/说明.txt', '素材/坏掉.mp4']
    const result = await app.call('import_video_edit_project_files', { documentRef: { kind: 'video_edit.document', id }, paths })
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) throw new Error('导入失败')
    const projectId = owner.session.documentMeta.container.kind === 'project' ? owner.session.documentMeta.container.projectId : ''
    expect(resolve).toHaveBeenCalledWith({ projectId, paths })
    expect(getPlatform().system.fs.readDirPage).toHaveBeenCalledWith(at('素材', '录屏'), { boundary: root })
    const data = result.data as { items: Array<Record<string, unknown>>; skipped: Array<Record<string, unknown>>; importedCount: number; reusedCount: number; skippedCount: number; verification: { verified: boolean } }
    const bin = owner.document.bins.find(value => value.name === '录屏')!
    const itemOf = (name: string) => owner.document.items.find(item => item.name === name)!
    expect(data.items).toEqual([
      { itemRef: { kind: 'video_edit.item', id: `${id}:${itemOf('产品主页.png').id}` }, mediaRef: { kind: 'video_edit.media', id: `${id}:${itemOf('产品主页.png').mediaId}` }, binRef: null, relativePath: '素材/截图/产品主页.png', status: 'imported' },
      { itemRef: { kind: 'video_edit.item', id: `${id}:${itemOf('a.mp4').id}` }, mediaRef: { kind: 'video_edit.media', id: `${id}:${itemOf('a.mp4').mediaId}` }, binRef: { kind: 'video_edit.bin', id: `${id}:${bin.id}` }, relativePath: '素材/录屏/a.mp4', status: 'imported' },
    ])
    expect(data.skipped.map(value => [value.relativePath, value.reason])).toEqual(expect.arrayContaining([
      ['素材/说明.txt', 'unsupported'], ['素材/录屏/notes.txt', 'unsupported'], ['素材/录屏/外链', 'outside_project'], ['素材/录屏/坏.mp4', 'unreadable'], ['素材/坏掉.mp4', 'unreadable'],
    ]))
    expect(data).toMatchObject({ importedCount: 2, reusedCount: 0, skippedCount: 5, verification: { verified: true } })
    expect(owner.document.items).toHaveLength(2); expect(owner.past).toHaveLength(history + 1)
    // 回执与日志里不出现项目文件夹的绝对位置
    expect(JSON.stringify(data)).not.toContain(root.replaceAll('\\', '\\\\'))

    // 再导入同一批：已在同一素材箱里的文件复用原素材项，不新增撤销步
    const again = await app.call('import_video_edit_project_files', { documentRef: { kind: 'video_edit.document', id }, paths: ['素材/截图/产品主页.png', '素材/录屏'] })
    expect(again).toMatchObject({ ok: true, data: { importedCount: 0, reusedCount: 2, items: [{ status: 'reused' }, { status: 'reused' }] } })
    expect(owner.document.items).toHaveLength(2); expect(owner.past).toHaveLength(history + 1)

    undoVideoEdit(id); expect(owner.document.items).toEqual([]); expect(owner.document.bins).toEqual([])
  } finally { app.dispose() }
})

it('任一路径被主进程拒绝时整次不导入，错误点名路径与原因并标为未执行；修正后可直接重试', async () => {
  const owner = await createVideoEditProject(); const id = owner.document.id; const original = owner.document; const history = owner.past.length
  vi.spyOn(getPlatform().documents, 'resolveProjectFiles').mockImplementation(async request => resolution(request))
  const app = createApplicationHarness()
  try {
    const result = await app.call('import_video_edit_project_files', { documentRef: { kind: 'video_edit.document', id }, paths: ['素材/截图/产品主页.png', '../项目外/机密.png', 'C:/Windows/win.ini', '素材/没有.png'] })
    expect(result).toMatchObject({ ok: false, error: { code: 'CAPABILITY_REJECTED', recoverable: true, details: {
      execution: { notExecuted: true },
      videoEdit: { reason: 'project_path_rejected', rejected: [
        { path: '../项目外/机密.png', reason: 'parent_segment' }, { path: 'C:/Windows/win.ini', reason: 'absolute_path' }, { path: '素材/没有.png', reason: 'not_found' },
      ] },
    } } })
    if (result.ok) throw new Error('应当拒绝')
    expect(result.error.message).toContain('“../项目外/机密.png”')
    expect({ ...owner.document, revision: original.revision }).toEqual(original); expect(owner.past).toHaveLength(history)
    expect(await app.call('import_video_edit_project_files', { documentRef: { kind: 'video_edit.document', id }, paths: ['素材/截图/产品主页.png'] })).toMatchObject({ ok: true, data: { importedCount: 1 } })
  } finally { app.dispose() }
})

it('指定的素材箱须属于这份剪辑；放进已有素材箱时散文件落在该素材箱', async () => {
  const owner = await createVideoEditProject(); const id = owner.document.id
  editVideoProject(id, document => ({ ...document, bins: [{ id: 'target', name: '截图' }] }))
  const resolve = vi.spyOn(getPlatform().documents, 'resolveProjectFiles').mockImplementation(async request => resolution(request))
  const app = createApplicationHarness()
  try {
    expect(await app.call('import_video_edit_project_files', { documentRef: { kind: 'video_edit.document', id }, paths: ['素材/截图/产品主页.png'], binRef: { kind: 'video_edit.bin', id: `${id}:missing` } }))
      .toMatchObject({ ok: false, error: { recoverable: true, details: { execution: { notExecuted: true } } } })
    expect(resolve).not.toHaveBeenCalled()
    expect(await app.call('import_video_edit_project_files', { documentRef: { kind: 'video_edit.document', id }, paths: ['素材/截图/产品主页.png'], binRef: { kind: 'video_edit.bin', id: `${id}:target` } }))
      .toMatchObject({ ok: true, data: { items: [{ binRef: { kind: 'video_edit.bin', id: `${id}:target` }, status: 'imported' }] } })
    expect(owner.document.items.map(item => item.binId)).toEqual(['target'])
  } finally { app.dispose() }
})

it('输入只接受相对路径字符串数组与可选素材箱：多余字段、空数组和超过 64 条在执行前拒绝', async () => {
  const owner = await createVideoEditProject(); const id = owner.document.id
  const resolve = vi.spyOn(getPlatform().documents, 'resolveProjectFiles')
  const app = createApplicationHarness()
  try {
    for (const input of [{ paths: [] }, { paths: Array.from({ length: 65 }, (_, index) => `素材/${index}.png`) }, { paths: ['素材/a.png'], root: 'C:/' }, { paths: [''] }]) {
      expect(await app.call('import_video_edit_project_files', { documentRef: { kind: 'video_edit.document', id }, ...input })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    }
    expect(resolve).not.toHaveBeenCalled()
  } finally { app.dispose() }
})
