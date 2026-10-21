import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createContentDiskCache } from '../media/content-disk-cache'
import type { SoundClapModels } from '../local-inference/sound/protocol'
import type { SoundLibraryFolderRecord } from '../../../../src/core/soundLibrary/soundLibraryFolders'
import { SoundLibraryService } from './service'

let root: string, cacheDir: string
const clap: SoundClapModels = { audioModelPath: 'a', textModelPath: 't', tokenizerPath: 'k', tokenizerConfigPath: 'c' }
const features = { durationSeconds: 0.8, attackSeconds: 0.1, hitSeconds: 0.3, peakDbfs: -1, loudnessLufs: -12, brightnessHz: 3000 }
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-sfx-')); cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-sfx-cache-'))
  await fs.mkdir(path.join(root, '转场'))
  for (const name of ['转场/嗖02-短   Whoosh 2 - Short.wav', 'Ping 1 - 平1.wav', 'Umbrella - 伞.wav', 'desktop.ini']) await fs.writeFile(path.join(root, name), name)
})
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); await fs.rm(cacheDir, { recursive: true, force: true }) })

function create(model: { ready: boolean }) {
  const analyzed: string[][] = []
  const folders: SoundLibraryFolderRecord[] = [{ id: '00000000-0000-4000-8000-000000000001', path: root, addedAt: '2026-10-21T00:00:00.000Z' }]
  const service = new SoundLibraryService({
    readFolders: async () => folders, writeFolders: async next => { folders.splice(0, folders.length, ...next) }, chooseFolder: async () => null, allowFolder: folder => folder,
    analyze: async (files, models) => { analyzed.push(files.map(file => path.basename(file))); return { decodeMs: 1, inferenceMs: 1, provider: models ? 'cpu' : null, files: files.map(file => file.includes('Umbrella') ? { path: file, ok: false as const, reason: '文件已损坏或不是有效的音频' } : { path: file, ok: true as const, features, ...(models ? { embedding: Array.from({ length: 512 }, (_, i) => (file.includes('Whoosh') ? i === 0 : i === 1) ? 1 : 0) } : {}) }) } },
    embedText: async () => [Array.from({ length: 512 }, (_, i) => i === 0 ? 1 : 0)],
    clapModels: async () => model.ready ? clap : null,
    cache: createContentDiskCache({ directory: () => cacheDir, extension: '.json' }), emit: vi.fn(), log: vi.fn(),
  })
  return { service, analyzed }
}

it('递归整理、坏文件跳过并说明；重启后全部命中缓存；改动的文件才重新分析', async () => {
  const first = create({ ready: false })
  const folder = (await first.service.refresh()).folders[0]
  expect(folder).toMatchObject({ status: 'ready', soundCount: 2, listeningCount: 0, skipped: [{ relativePath: 'Umbrella - 伞.wav', reason: '文件已损坏或不是有效的音频' }] })
  const second = create({ ready: false })
  await second.service.refresh(); expect(second.analyzed).toEqual([])
  await fs.writeFile(path.join(root, 'Ping 1 - 平1.wav'), 'changed!')
  await second.service.refresh(); expect(second.analyzed).toEqual([['Ping 1 - 平1.wav']])
})

it('模型未下载时只按名字并说明；下载后只补算缺向量的音效，再按英文描述融合听音', async () => {
  const model = { ready: false }
  const { service, analyzed } = create(model)
  const byName = await service.search({ keywords: ['whoosh'], description: 'a fast whoosh', limit: 5 })
  expect(byName).toMatchObject({ listening: 'model_not_downloaded', noGoodMatch: false }); expect(byName.matches[0].english).toBe('Whoosh 2 - Short')
  model.ready = true
  const heard = await service.search({ keywords: [], description: 'a fast whoosh', limit: 5 })
  expect(analyzed.at(-1)?.sort()).toEqual(['Ping 1 - 平1.wav', '嗖02-短   Whoosh 2 - Short.wav'])
  expect(heard.listening).toBe('used'); expect(heard.matches[0]).toMatchObject({ english: 'Whoosh 2 - Short', matchedBy: ['listening'] })
  const located = await service.locate(heard.matches[0].id)
  expect(located.path).toBe(path.join(root, '转场', '嗖02-短   Whoosh 2 - Short.wav'))
  await expect(service.search({ keywords: ['applause'], limit: 3 })).resolves.toMatchObject({ noGoodMatch: true })
  await expect(service.search({ keywords: ['x'], folderIds: ['missing'], limit: 3 })).rejects.toThrow('已登记的有')
})

it('直接给路径登记文件夹，不弹选择框；同一路径重复登记沿用原文件夹；不是文件夹时说明路径', async () => {
  const { service } = create({ ready: false })
  const other = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-sfx-path-'))
  try {
    const added = await service.addFolder(other)
    expect(added).toMatchObject({ path: path.resolve(other) })
    expect((await service.addFolder(other))?.id).toBe(added?.id)
    await expect(service.addFolder(path.join(other, '不存在'))).rejects.toThrow('不是文件夹或不存在')
  } finally { await fs.rm(other, { recursive: true, force: true }) }
})
