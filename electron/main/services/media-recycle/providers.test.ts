import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ warn: vi.fn(), roots: [] as string[], getDb: vi.fn() }))
vi.mock('../db', () => ({ getDb: mocks.getDb }))
vi.mock('../db-locations', () => ({ databaseLocationContext: vi.fn() }))
vi.mock('../appPaths', () => ({ getUserRootDir: () => path.resolve(path.sep, 'user'), getProgramDataDir: () => 'D:/program', getProgramStoreDir: () => 'D:/program/thumbnails', getUserModelsLocation: () => ({ dir: 'D:/user/models' }) }))
vi.mock('./queue', () => ({ overlapsManagedMediaRoot: (value: string) => mocks.roots.some(root => root === value), managedMediaRoots: () => mocks.roots }))
vi.mock('../logging/main-logger', () => ({ createMainLogger: () => ({ warn: mocks.warn }) }))
vi.mock('../image-editor-v3/resource-media-url', () => ({ resolveImageEditorV3ResourceMediaUrl: vi.fn() }))
import { collectDocumentReferences, decodeReferenceValues, recordReferences, releaseDocumentSubmissionReferences } from './providers'
import { databaseLocationContext } from '../db-locations'
import * as scanner from './file-scanner'
import { MediaRecycleDeadline } from './lifecycle'
import { collectUnreferencedMedia } from './collector'
import { canonicalPath, fileIdentity } from './paths'
import { buildProjectManifest } from '../../../../src/core/documents/projectManifest'

it('项目已从索引移除后，回收副本仍按原项目解码相对媒体引用', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-recycle-project-')); directories.push(root)
  const backup = path.join(root, 'backup'), target = path.join(root, 'project')
  await fs.mkdir(path.join(backup, '.henji'), { recursive: true })
  await fs.writeFile(path.join(backup, '.henji', 'project.json'), JSON.stringify(buildProjectManifest({ id: 'recovered-project', createdAt: new Date().toISOString(), locale: 'zh', draft: false })))
  mocks.getDb.mockReturnValue({ prepare: (sql: string) => ({ all: () => sql.includes("kind = 'file'") ? [{ payload: backup, target }] : [] }) })
  vi.mocked(databaseLocationContext).mockReturnValue({ style: process.platform === 'win32' ? 'win32' : 'posix', userRoot: path.join(root, 'user'), projects: [] })
  vi.spyOn(scanner, 'scanReferenceFiles').mockImplementationOnce(async (_roots, _extensions, _signal, consume) => {
    await consume(path.join(backup, '剪辑.hjvideo'), ['henji:/素材/旁白.wav'])
    return { skippedLinks: [], unreadableLinks: [] }
  })
  expect((await collectDocumentReferences(new AbortController().signal)).references).toEqual([path.join(target, '素材', '旁白.wav')])
})

const context = { style: 'win32' as const, userRoot: 'D:/user', projects: [] }
const directories: string[] = []
it('未拼接录音及已发布但未提交的结果受恢复登记保护', () => {
  const name = '录音 2026-10-23 120000.wav'
  const references = recordReferences('settings', { key: 'audio_capture.pending_files', type: 'json', value: JSON.stringify({ version: 2, minReaderVersion: 1, files: [name], placements: { [name]: { spliceId: 'result-uuid' } } }) }, context)
  expect(references).toContain(path.join(path.resolve(path.sep, 'user'), '录音', name))
  expect(references).toContain(path.join(path.resolve(path.sep, 'user'), '录音', 'result-uuid.wav'))
})
afterEach(async () => { mocks.roots = []; vi.restoreAllMocks(); vi.clearAllMocks(); for (const dir of directories.splice(0)) await fs.rm(dir, { recursive: true, force: true }) })

it('没有待交接的生成回执时不对所有文档引用做文件查询', async () => {
  const prepare = vi.fn(() => ({ get: () => undefined }))
  mocks.getDb.mockReturnValue({ prepare })
  const realpath = vi.spyOn(fs, 'realpath')
  await releaseDocumentSubmissionReferences(Array.from({ length: 11_263 }, (_, index) => path.resolve('missing', `${index}.png`)), new AbortController().signal)
  expect(prepare).toHaveBeenCalledOnce()
  expect(realpath).not.toHaveBeenCalled()
})

it('最后一个引用解析期间截止后不再查询数据库上下文', async () => {
  mocks.getDb.mockReturnValue({ prepare: () => ({ get: () => ({ pending: true }) }) })
  const controller = new AbortController(); const error = new MediaRecycleDeadline()
  vi.spyOn(fs, 'realpath').mockImplementationOnce(async () => { controller.abort(error); return path.resolve('held.png') })
  await expect(releaseDocumentSubmissionReferences([path.resolve('held.png')], controller.signal)).rejects.toBe(error)
  expect(databaseLocationContext).not.toHaveBeenCalled()
})

it('链接目标不可读时继续其他普查，但保护全部已登记媒体', async () => {
  const held = 'D:/user/generated/held.png'
  mocks.getDb.mockReturnValue({ prepare: (sql: string) => ({ all: () => sql.includes('media_recycle_owned') ? [{ path: held }] : [] }) })
  vi.mocked(databaseLocationContext).mockReturnValue(context)
  vi.spyOn(scanner, 'scanReferenceFiles').mockResolvedValue({ skippedLinks: ['D:/unreadable'], unreadableLinks: ['D:/unreadable'] })
  expect(await collectDocumentReferences(new AbortController().signal)).toEqual({ references: [], protection: [held] })
  expect(mocks.warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: 'media_recycle.references.link_skipped', context: expect.objectContaining({ protectOwnedMedia: true }) }))
})

it('悬空链接后有作品时，本轮不回收任何已登记媒体', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-provider-offline-')); directories.push(root)
  const user = path.join(root, 'user'); const external = path.join(root, 'external'); const generated = path.join(user, 'generated')
  await fs.mkdir(generated, { recursive: true }); await fs.mkdir(external)
  const held = path.join(generated, 'held.png'); const unused = path.join(generated, 'unused.png')
  for (const file of [held, unused]) await fs.writeFile(file, 'owned')
  await fs.writeFile(path.join(external, 'saved.hjcvs'), JSON.stringify({ image: held }))
  const link = path.join(user, 'external'); await fs.symlink(external, link, 'junction')
  await fs.rename(external, path.join(root, 'offline'))
  mocks.roots = [generated]
  mocks.getDb.mockReturnValue({ prepare: (sql: string) => ({ all: () => sql.includes('media_recycle_owned') ? [{ path: held }, { path: unused }] : [] }) })
  vi.mocked(databaseLocationContext).mockReturnValue({ style: process.platform === 'win32' ? 'win32' : 'posix', userRoot: user, projects: [] })
  const signal = new AbortController().signal
  const documents = await collectDocumentReferences(signal)
  expect(documents.references).toEqual([])
  expect(documents.protection).toEqual([held, unused])
  expect(mocks.warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: 'media_recycle.references.link_skipped', context: { paths: [link], protectOwnedMedia: true } }))
  const trashItem = vi.fn(); const forget = vi.fn()
  const identity = fileIdentity(await fs.stat(held))
  const result = await collectUnreferencedMedia({ roots: async () => [generated], revision: () => 'stable', log: vi.fn(), trashItem,
    providers: [{ id: 'documents', collect: async () => [...documents.references, ...documents.protection] }],
    store: { candidates: async function* () { yield { id: 1, paths: [held] }; yield { id: 2, paths: [unused] } }, identity: () => identity, forget },
  }, signal)
  expect(result.deleted).toBe(0)
  expect(result.retained.referenced).toBe(2)
  expect(trashItem).not.toHaveBeenCalled(); expect(forget).not.toHaveBeenCalled()
  for (const file of [held, unused]) expect(await fs.readFile(file, 'utf8')).toBe('owned')
})

it('按表行汇总未知项目，过滤失效项目引用但保留同一行其他引用', () => {
  expect(recordReferences('assets', { id: 'a', file_path: 'henji://project/gone/media.png' }, context)).toEqual([])
  expect(mocks.warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: 'media_recycle.references.unknown_project', context: expect.objectContaining({ source: 'assets', rowId: 'a', projectIds: ['gone'] }) }))
  expect(decodeReferenceValues(['henji://project/gone/media.png', 'D:/user/generated/a.png'], context)).toEqual(['D:/user/generated/a.png'])
})
it('无容器、无效路径与未知项目内的越界仍然阻断扫描', () => {
  for (const value of ['henji:/a.png', 'henji://bad/a.png', 'henji://project/gone/../a.png']) expect(() => decodeReferenceValues(value, context)).toThrow('Unresolved')
  mocks.roots = ['D:/user/generated']
  expect(() => decodeReferenceValues('henji://project/gone/a.png', { ...context, projects: [{ id: 'overlap', root: 'D:/user/generated' }] })).toThrow()
})
it('残留项目素材不妨碍无关无人引用的托管候选回收', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-provider-')); directories.push(root)
  const file = path.join(root, 'unused.png'); await fs.writeFile(file, 'unused')
  const key = await canonicalPath(file); const identity = fileIdentity(await fs.stat(file)); const forget = vi.fn()
  const result = await collectUnreferencedMedia({ roots: async () => [root], revision: () => 'stable', log: vi.fn(), trashItem: file => fs.rename(file, `${file}.trashed`),
    providers: [{ id: 'assets', collect: async () => recordReferences('assets', { id: 'a', file_path: 'henji://project/gone/a.png' }, context) }],
    store: { candidates: async function* () { yield { id: 1, paths: [file] } }, identity: value => value === key ? identity : undefined, forget },
  }, new AbortController().signal)
  expect(result.deleted).toBe(1); expect(forget).toHaveBeenCalledWith(1)
  await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
})
