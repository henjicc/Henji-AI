import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ warn: vi.fn(), roots: [] as string[] }))
vi.mock('../db', () => ({ getDb: vi.fn() }))
vi.mock('../db-locations', () => ({ databaseLocationContext: vi.fn() }))
vi.mock('../appPaths', () => ({ getUserRootDir: () => path.resolve(path.sep, 'user'), getProgramDataDir: () => 'D:/program', getProgramStoreDir: () => 'D:/program/thumbnails' }))
vi.mock('./queue', () => ({ overlapsManagedMediaRoot: (value: string) => mocks.roots.some(root => root === value), managedMediaRoots: () => mocks.roots }))
vi.mock('../logging/main-logger', () => ({ createMainLogger: () => ({ warn: mocks.warn }) }))
vi.mock('../image-editor-v3/resource-media-url', () => ({ resolveImageEditorV3ResourceMediaUrl: vi.fn() }))
import { decodeReferenceValues, recordReferences } from './providers'
import { collectUnreferencedMedia } from './collector'
import { canonicalPath, fileIdentity } from './paths'

const context = { style: 'win32' as const, userRoot: 'D:/user', projects: [] }
const directories: string[] = []
it('未拼接录音及已发布但未提交的结果受恢复登记保护', () => {
  const name = '录音 2026-10-23 120000.wav'
  const references = recordReferences('settings', { key: 'audio_capture.pending_files', type: 'json', value: JSON.stringify({ version: 2, minReaderVersion: 1, files: [name], placements: { [name]: { spliceId: 'result-uuid' } } }) }, context)
  expect(references).toContain(path.join(path.resolve(path.sep, 'user'), '录音', name))
  expect(references).toContain(path.join(path.resolve(path.sep, 'user'), '录音', 'result-uuid.wav'))
})
afterEach(async () => { mocks.roots = []; vi.clearAllMocks(); for (const dir of directories.splice(0)) await fs.rm(dir, { recursive: true, force: true }) })

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
  const result = await collectUnreferencedMedia({ roots: async () => [root], revision: () => 'stable', log: vi.fn(),
    providers: [{ id: 'assets', collect: async () => recordReferences('assets', { id: 'a', file_path: 'henji://project/gone/a.png' }, context) }],
    store: { candidates: async function* () { yield { id: 1, paths: [file] } }, identity: value => value === key ? identity : undefined, forget },
  }, new AbortController().signal)
  expect(result.deleted).toBe(1); expect(forget).toHaveBeenCalledWith(1)
  await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
})
