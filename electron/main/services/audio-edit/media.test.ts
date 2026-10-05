import { afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { AudioEditProjectDocument } from '../../../../src/core/audioEdit/types'
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), error: vi.fn() }) }))
vi.mock('../db', () => ({ getDb: vi.fn() }))
vi.mock('../appPaths', () => ({ getProgramStoreDir: () => `${os.tmpdir()}/AudioEdit` }))
vi.mock('../media/shared', () => ({ resolveLocalMediaPath: async (value: string) => value }))
vi.mock('./project-store', () => ({ requireAudioEditProject: vi.fn() }))
import { identifyAudioEditSource, verifyAudioEditSource, audioEditCacheDirectory } from './media'

let directory: string | undefined
afterEach(async () => { if (directory) await fs.rm(directory, { recursive: true, force: true }); directory = undefined })
it('detects same-name, same-size, restored-time replacement without altering the source', async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-source-test-'))
  const file = path.join(directory, '中文 & # 原素材.wav')
  await fs.writeFile(file, 'original')
  const identity = await identifyAudioEditSource(file)
  const project = { source: { sourcePath: file, identity } } as AudioEditProjectDocument
  await expect(verifyAudioEditSource(project)).resolves.toBeUndefined()
  await fs.writeFile(file, 'replaced')
  await fs.utimes(file, new Date(identity.mtimeMs), new Date(identity.mtimeMs))
  await expect(verifyAudioEditSource(project)).rejects.toThrow('内容已改变')
  expect(await fs.readFile(file, 'utf8')).toBe('replaced')
  await fs.rename(file, path.join(directory, '移动.wav'))
  await expect(verifyAudioEditSource(project)).rejects.toThrow('重新定位')
})
it('rejects cache traversal before filesystem deletion is possible', () => {
  expect(() => audioEditCacheDirectory('../original')).toThrow('无效')
  expect(() => audioEditCacheDirectory('C:\\original')).toThrow('无效')
  expect(audioEditCacheDirectory('safe-project')).toBe(path.join(os.tmpdir(), 'AudioEdit', 'safe-project', 'cache'))
})
