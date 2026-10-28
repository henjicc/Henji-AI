vi.mock('../../../../electron/main/protocol', () => ({ allowMediaRoot: vi.fn(), isPathWithinAllowedMediaRoots: () => true }))
vi.mock('../../../../electron/main/services/db', () => ({ getDb: vi.fn() }))
vi.mock('../../../../electron/main/services/logging', () => ({ createMainLogger: () => ({ trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))
vi.mock('../../../../electron/main/services/asset-library/mediaInspection', () => ({ normalizeAssetPath: (value: string) => value, inspectMedia: vi.fn() }))
vi.mock('../../../../electron/main/services/asset-library/thumbnailService', () => ({ ensureAssetThumbnail: vi.fn() }))
vi.mock('../../../../electron/main/services/media-import/probe', () => ({ probeLocalMedia: vi.fn(async () => { throw Object.assign(new Error('not media'), { code: 'MEDIA_FORMAT_UNSUPPORTED' }) }) }))
// @vitest-environment jsdom
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { importLocalMediaCapability } from '@/core/application-control/domains/asset/localMediaImportCapability'
import { getPlatform } from '@/platform/runtime'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createVideoEditTestProject, savedVideoEdit } from '@/features/videoEdit/application/videoEditDocumentTestKit'
import { closeVideoEditProject, listVideoEditInstances } from '@/features/videoEdit/application/videoEditService'
import { videoEditNativeMediaProbe } from '@/features/videoEdit/application/videoEditMediaProbe'
import type { AssetRecord } from '@/platform/contracts/assetLibrary'
import { importVideoEditPathsAndFolders } from '@/features/videoEdit/application/videoEditFolderImport'
import { useSettingsStore } from '@/stores/settingsStore'
import { validateLocalMediaSource } from '../../../../electron/main/services/media-import/sourceValidation'
import { inspectAssetFileContent } from '../../../../electron/main/services/asset-library'
import { probeLocalMedia } from '../../../../electron/main/services/media-import/probe'
import { dropVideoEditInput } from '@/features/videoEdit/application/videoEditDrop'
import { verifyVideoEditMediaContent } from '@/features/videoEdit/videoEditMediaContent'
import { readDirectoryPage } from '../../../../electron/main/services/systemDirectory'
import { removeTemporaryDirectory } from '@/tests/removeTemporaryDirectory'

vi.mock('mediabunny', () => ({ ALL_FORMATS: [], UrlSource: class {}, Input: class {
  async getPrimaryVideoTrack() { return null }
  async getPrimaryAudioTrack() { return { codec: null, canDecode: async () => true, numberOfChannels: 1, sampleRate: 48000 } }
  async getAudioTracks() { return [await this.getPrimaryAudioTrack()] }
  async computeDuration() { return 2 }
  dispose() {}
} }))

let root: string
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-local-import-result-'))
  await fs.mkdir(path.join(root, 'project')); await fs.mkdir(path.join(root, 'outside'))
  installHarnessNativeStorage()
  vi.spyOn(getPlatform().media, 'importFromPath').mockImplementation(async request => {
    const source = await validateLocalMediaSource(request.sourcePath, request.expectedKind, false)
    return { kind: 'audio', importId: request.importId, fullPath: source.sourcePath, ownership: 'referenced', mimeType: source.format.mimeType, sizeBytes: source.sizeBytes, cacheHit: true, durationSeconds: 2 }
  })
  vi.spyOn(getPlatform().system.fs, 'readDirPage').mockImplementation((target, options) => readDirectoryPage(target, options ?? {}, 123))
  vi.spyOn(getPlatform().system.fs, 'exists').mockImplementation(async target => { try { await fs.access(target); return true } catch { return false } })
  vi.spyOn(getPlatform().system.paths, 'dirname').mockImplementation(async target => path.dirname(target))
  vi.spyOn(getPlatform().media, 'allowRoot').mockResolvedValue(undefined)
  vi.spyOn(getPlatform().assetLibrary, 'inspectFileContent').mockImplementation(async (file, _kind, verifyImport) => {
    if (verifyImport) await validateLocalMediaSource(file, undefined, false)
    return { sizeBytes: 8, fileModifiedAt: 1000, contentIdentity: 'a'.repeat(64) }
  })
  vi.spyOn(videoEditNativeMediaProbe, 'forcedBackend').mockResolvedValue('browser')
  useSettingsStore.getState().setVideoEditImportFolderBins(true)
  useSettingsStore.getState().setVideoEditDuplicatePolicy('skip')
})
afterEach(async () => {
  for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id)
  vi.restoreAllMocks(); uninstallHarnessNativeStorage(); await removeTemporaryDirectory(root)
})

it('发现正式声明后按项目外路径导入资产，按稳定引用回读存储；伪装格式拒绝后修正可重试', async () => {
  const target = path.join(root, 'outside', 'voice.mp3'); const recordPath = path.join(root, 'project', 'asset.json')
  let created = false
  const create = vi.spyOn(getPlatform().assetLibrary, 'createAsset').mockImplementation(async input => {
    const record: AssetRecord = { ...input, id: 'imported', displayName: input.displayName ?? '素材', displayUrl: `henji-media://local/${encodeURIComponent(input.filePath)}`, mimeType: 'audio/mpeg', sizeBytes: 8, width: null, height: null, durationSeconds: 2, thumbnailPath: null, thumbnailUrl: null, inspectionStatus: 'ready', inspectionError: null, fileModifiedAt: 1000, lastUsedAt: null, createdAt: 1, updatedAt: 1, tags: [], libraryIds: [] }
    const wasExisting = created; created = true
    await fs.writeFile(recordPath, JSON.stringify(record)); return { ...record, wasExisting }
  })
  vi.spyOn(getPlatform().assetLibrary, 'inspectAsset').mockImplementation(async () => JSON.parse(await fs.readFile(recordPath, 'utf8')) as AssetRecord)
  const app = createApplicationHarness()
  try {
    expect(app.session.list().find(item => item.id === 'import_local_media')?.aiInputSchema).toMatchObject({ additionalProperties: false, properties: { path: { type: 'string' } } })
    expect(await app.call('describe_application_entities', { entityTypes: ['asset'] })).toMatchObject({ ok: true })
    await fs.writeFile(target, 'private text')
    expect(await app.call('import_local_media', { path: target })).toMatchObject({ ok: false, error: { details: { execution: { notExecuted: true } }, message: expect.stringContaining('MEDIA_FORMAT_UNSUPPORTED') } })
    expect(create).not.toHaveBeenCalled()
    expect(await app.call('import_local_media', { path: target + ' ' })).toMatchObject({ ok: false, error: { message: expect.stringContaining('MEDIA_PATH_TRAILING_CHARACTER') } })
    expect(getPlatform().media.importFromPath).toHaveBeenLastCalledWith(expect.objectContaining({ verifyContent: true }))
    await fs.writeFile(target, Buffer.from('ID3media'))
    const result = await app.call('import_local_media', { path: target })
    expect(result).toMatchObject({ ok: true, data: { assetRef: { kind: 'asset', id: 'imported' }, verification: { verified: true } } })
    expect(await app.read({ kind: 'asset', id: 'imported' }, ['asset.display_name'])).toMatchObject({ properties: { 'asset.display_name': 'voice.mp3' } })
    expect(JSON.parse(await fs.readFile(recordPath, 'utf8')).filePath).toBe(target)
    expect(await fs.readFile(target, 'utf8')).toBe('ID3media')
    const reused = await app.call('import_local_media', { path: target })
    expect(reused).toMatchObject({ ok: true, data: { reused: true } })
    if (reused.ok) expect(importLocalMediaCapability.resolveObservedEffects?.({ path: target }, importLocalMediaCapability.outputSchema.parse(reused.data)).some(effect => effect.effect === 'create')).toBe(false)
    if (result.ok) expect(JSON.stringify(result.data)).not.toContain(target.replaceAll('\\', '\\\\'))
    create.mockRejectedValueOnce(new Error(`EACCES ${target}`))
    const failed = await app.call('import_local_media', { path: target })
    expect(failed).toMatchObject({ ok: false, error: { message: expect.stringContaining('素材登记未确认') } })
    expect(JSON.stringify(failed)).not.toContain(target.replaceAll('\\', '\\\\'))
  } finally { app.dispose() }
})

it('任意绝对路径文件和目录通过正式调用递归、联接防回环、去重、保存读回并一步撤销，无需弹窗', async () => {
  const outside = path.join(root, 'outside'); const nested = path.join(outside, 'nested'); await fs.mkdir(nested)
  await fs.writeFile(path.join(outside, 'a.mp3'), 'ID3media'); await fs.writeFile(path.join(nested, 'b.mp3'), 'ID3media')
  await fs.symlink(outside, path.join(nested, 'back'), process.platform === 'win32' ? 'junction' : 'dir')
  const link = path.join(root, 'project', 'link'); await fs.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
  const owner = await createVideoEditTestProject(); const documentRef = { kind: 'video_edit.document', id: owner.document.id }
  const dialog = vi.spyOn(getPlatform().system.dialog, 'open')
  const app = createApplicationHarness()
  try {
    expect(app.session.list().find(item => item.id === 'import_video_edit_folder')?.aiInputSchema).toMatchObject({ properties: { paths: { type: 'array' } } })
    expect(await app.call('describe_application_entities', { refs: [documentRef] })).toMatchObject({ ok: true })
    expect(await app.call('import_video_edit_folder', { documentRef, paths: ['relative.mp3'] })).toMatchObject({ ok: false, error: { details: { execution: { notExecuted: true } } } })
    const result = await app.call('import_video_edit_folder', { documentRef, paths: [link, link] })
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, data: { verification: { verified: true }, skippedEntries: expect.arrayContaining([expect.objectContaining({ reason: 'repeated_folder' })]) } })
    expect(dialog).not.toHaveBeenCalled(); expect(owner.document.items).toHaveLength(2)
    expect(savedVideoEdit(owner).media.map(item => item.path).sort()).toEqual([path.join(outside, 'a.mp3'), path.join(nested, 'b.mp3')].sort())
    expect(await app.call('undo_video_edit', { documentRef })).toMatchObject({ ok: true })
    expect(savedVideoEdit(owner).items).toEqual([]); expect(savedVideoEdit(owner).bins).toEqual([])
    expect(await app.call('import_video_edit_folder', { documentRef, paths: [path.join(outside, 'a.mp3')] })).toMatchObject({ ok: true })
    expect(savedVideoEdit(owner).items).toHaveLength(1)
    expect(getPlatform().media.importFromPath).not.toHaveBeenCalled()
  } finally { app.dispose() }
})


it('助手拒绝裸 PCM；纯重复返回已有素材引用，超过回执上限明确标记截断', async () => {
  const pcm = path.join(root, 'outside', 'voice.pcm'); await fs.writeFile(pcm, Buffer.from([1, 2, 3]))
  const owner = await createVideoEditTestProject(); const app = createApplicationHarness()
  const documentRef = { kind: 'video_edit.document', id: owner.document.id }
  try {
    expect(await app.call('import_local_media', { path: pcm })).toMatchObject({ ok: false, error: { details: { execution: { notExecuted: true } }, message: expect.stringContaining('WAV') } })
    const paths = Array.from({ length: 65 }, (_, index) => path.join(root, 'outside', `voice${index}.mp3`))
    await Promise.all(paths.map(target => fs.writeFile(target, 'ID3media')))
    expect(await app.call('import_video_edit_folder', { documentRef, paths: [pcm] })).toMatchObject({ ok: false, error: { details: { execution: { notExecuted: true } } } })
    useSettingsStore.getState().setVideoEditImportFolderBins(false)
    const first = await app.call('import_video_edit_folder', { documentRef, paths: [path.join(root, 'outside')] })
    expect(first, JSON.stringify(first)).toMatchObject({ ok: true, data: { truncated: true } })
    if (!first.ok) throw new Error(JSON.stringify(first))
    expect((first.data as { itemRefs: unknown[] }).itemRefs).toHaveLength(64)
    const ids = savedVideoEdit(owner).items.map(item => item.id)
    expect(ids).toHaveLength(65)
    const duplicate = await app.call('import_video_edit_folder', { documentRef, paths: [paths[0]] })
    expect(duplicate).toMatchObject({ ok: true, data: { itemRefs: [{ kind: 'video_edit.item', id: `${owner.document.id}:${ids[0]}` }], truncated: false } })
    expect(savedVideoEdit(owner).items.map(item => item.id)).toEqual(ids)
  } finally { app.dispose() }
})

it('排队期间其他请求导入成功，不会把本次全部失败误报为成功', async () => {
  const good = path.join(root, 'outside', 'good.mp3'); await fs.writeFile(good, 'ID3media')
  const missing = path.join(root, 'outside', 'missing.mp3')
  const owner = await createVideoEditTestProject(); const documentRef = { kind: 'video_edit.document', id: owner.document.id }
  let release!: () => void; let entered!: () => void
  const gate = new Promise<void>(resolve => { release = resolve }); const started = new Promise<void>(resolve => { entered = resolve })
  vi.mocked(getPlatform().system.fs.exists).mockImplementation(async target => {
    if (target === good) { entered(); await gate; return true }
    return target !== missing
  })
  const pending = importVideoEditPathsAndFolders(owner.document.id, [good])
  await started
  const app = createApplicationHarness()
  try {
    const failed = app.call('import_video_edit_folder', { documentRef, paths: [missing] })
    release(); await pending
    expect(await failed).toMatchObject({ ok: false, error: { details: { execution: { notExecuted: true } } } })
    expect(owner.document.items).toHaveLength(1)
  } finally { release(); app.dispose() }
})

it('老式 MOV、RF64 WAV、TS 和 TIFF 经正式拖入保存后，剪辑仍可核对原件读取', async () => {
  const directory = path.join(root, 'outside')
  const fixtures = [{ name: 'legacy.mov', bytes: '0000wide0000mdat' }, { name: 'professional.wav', bytes: 'RF64xxxxWAVE' }, { name: 'transport.ts', bytes: 'Gtransport' }]
  for (const fixture of fixtures) await fs.writeFile(path.join(directory, fixture.name), fixture.bytes)
  const sharp = (await import('sharp')).default
  const image = path.join(directory, 'picture.tif')
  await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).tiff().toFile(image)
  vi.mocked(probeLocalMedia).mockImplementation(async file => ({ hasAudio: true, width: file.endsWith('.wav') ? 0 : 1920, height: file.endsWith('.wav') ? 0 : 1080, durationSeconds: 2 }))
  vi.mocked(getPlatform().assetLibrary.inspectFileContent).mockImplementation(inspectAssetFileContent)
  const paths = [...fixtures.map(fixture => path.join(directory, fixture.name)), image]
  const owner = await createVideoEditTestProject()
  expect(await dropVideoEditInput(owner.document.id, { kind: 'sources', sources: paths.map(path => ({ path })) })).toHaveLength(4)
  const app = createApplicationHarness()
  try { expect(await app.call('save_video_edit', { documentRef: { kind: 'video_edit.document', id: owner.document.id } })).toMatchObject({ ok: true }) }
  finally { app.dispose() }
  const saved = savedVideoEdit(owner)
  expect(saved.media.map(media => media.path)).toEqual(paths)
  for (const media of saved.media) await verifyVideoEditMediaContent(media)
})

it('助手路径导入在写入剪辑前拒绝伪装文件，修正内容后可导入；界面身份检查不探测格式', async () => {
  const target = path.join(root, 'outside', 'renamed.mp3'); await fs.writeFile(target, 'private text')
  const owner = await createVideoEditTestProject(); const app = createApplicationHarness()
  const documentRef = { kind: 'video_edit.document', id: owner.document.id }
  try {
    const failed = await app.call('import_video_edit_folder', { documentRef, paths: [target] })
    expect(failed).toMatchObject({ ok: false, error: { details: { execution: { notExecuted: true } } } })
    expect(savedVideoEdit(owner).items).toEqual([])
    await fs.writeFile(target, 'ID3media')
    expect(await app.call('import_video_edit_folder', { documentRef, paths: [target] })).toMatchObject({ ok: true })
    expect(savedVideoEdit(owner).media[0].path).toBe(target)
    await fs.writeFile(target, 'private text')
    expect(await app.call('import_video_edit_folder', { documentRef, paths: [target] })).toMatchObject({ ok: false, error: { details: { execution: { notExecuted: true } } } })
    expect(savedVideoEdit(owner).items).toHaveLength(1)
    await expect(inspectAssetFileContent(target, 'audio')).resolves.toMatchObject({ sizeBytes: 12 })
    await expect(inspectAssetFileContent(target, 'audio', true)).rejects.toThrow('MEDIA_FORMAT_UNSUPPORTED')
  } finally { app.dispose() }
})

it('助手导入代码目录时 .ts 作为格式不支持跳过、不启动 ffprobe；空路径结果有准确提示', async () => {
  const directory = path.join(root, 'outside')
  await fs.writeFile(path.join(directory, 'source.ts'), 'export const value = 1')
  await fs.writeFile(path.join(directory, 'voice.mp3'), 'ID3media')
  const owner = await createVideoEditTestProject(); const app = createApplicationHarness()
  const documentRef = { kind: 'video_edit.document', id: owner.document.id }
  try {
    vi.mocked(probeLocalMedia).mockClear()
    expect(await app.call('import_video_edit_folder', { documentRef, paths: [directory] })).toMatchObject({ ok: true, data: { skippedEntries: [expect.objectContaining({ name: 'source.ts', reason: 'unsupported' })] } })
    expect(savedVideoEdit(owner).media.map(media => path.basename(media.path))).toEqual(['voice.mp3'])
    expect(probeLocalMedia).not.toHaveBeenCalled()
    const empty = path.join(root, 'empty'); await fs.mkdir(empty)
    useSettingsStore.getState().setVideoEditImportFolderBins(false)
    const failed = await app.call('import_video_edit_folder', { documentRef, paths: [empty] })
    expect(failed).toMatchObject({ ok: false, error: { message: '这些路径下没有可导入的媒体。', details: { execution: { notExecuted: true } } } })
  } finally { app.dispose() }
})
