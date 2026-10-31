import { createHash } from 'node:crypto'
// @vitest-environment jsdom
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { styleCodeFixture } from '@/core/videoEdit/styleCodeTestFixtures'
import { VIDEO_EDIT_EFFECT_LIBRARY_VERSION } from '@/core/persistence/schemaVersions'
import { createVideoEditEffectLibraryStore, VIDEO_EDIT_EFFECT_LIBRARY_STORAGE_KEY } from './videoEditEffectPresets'
import { desktopEffectLibrarySources } from './videoEditEffectLibrarySources'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createTestEnvironment } from '../../../../electron/main/services/documents/documents.test-support'

it('源码独立落盘、重开按摘要读回；历史内联库先备份，读取不重写原库，保存才发布引用', async () => {
  installHarnessNativeStorage()
  const env = createTestEnvironment(), root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-library-'))
  const values = new Map<string, string>()
  const disk = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
  const platform = getPlatform()
  vi.spyOn(platform.system.paths, 'appLocalDataDir').mockResolvedValue(root)
  vi.spyOn(platform.system.paths, 'join').mockImplementation(async (...parts) => path.join(...parts))
  vi.spyOn(platform.system.fs, 'mkdir').mockImplementation(async value => { await fs.mkdir(value, { recursive: true }) })
  vi.spyOn(platform.system.fs, 'writeFile').mockImplementation(async (file, bytes, options) => { await fs.writeFile(file, bytes, { flag: options?.exclusive ? 'wx' : 'w' }) })
  vi.spyOn(platform.system.fs, 'exists').mockImplementation(async file => fs.access(file).then(() => true, () => false))
  vi.spyOn(platform.documents, 'readCodeFile').mockImplementation(env.services.service.readCodeFile)
  try {
    const preset = styleCodeFixture(), source = preset.codeSnapshots!.code.codeSources[0]
    const original = JSON.stringify({ version: VIDEO_EDIT_EFFECT_LIBRARY_VERSION - 1, content: { favorites: [`preset:${preset.id}`], presets: [preset] } })
    disk.setItem(VIDEO_EDIT_EFFECT_LIBRARY_STORAGE_KEY, original)
    const store = createVideoEditEffectLibraryStore(disk, desktopEffectLibrarySources)
    await store.getState().ready()
    expect(disk.getItem(`${VIDEO_EDIT_EFFECT_LIBRARY_STORAGE_KEY}:backup:v${VIDEO_EDIT_EFFECT_LIBRARY_VERSION - 1}`)).toBe(original)
    expect(disk.getItem(VIDEO_EDIT_EFFECT_LIBRARY_STORAGE_KEY)).toBe(original)
    expect(await fs.readFile(path.join(root, 'code-sources', `${source.hash}.js`), 'utf8')).toBe(source.source)
    expect(store.getState().presets).toEqual([preset])
    store.getState().renamePreset(preset.id, '磁盘代码')
    const saved = disk.getItem(VIDEO_EDIT_EFFECT_LIBRARY_STORAGE_KEY)!
    expect(saved).not.toContain(source.source)
    expect(JSON.parse(saved).content.presets[0].codeSnapshots.code.codeSources).toEqual([{ hash: source.hash }])
    const reopened = createVideoEditEffectLibraryStore(disk, desktopEffectLibrarySources)
    await reopened.getState().ready()
    expect(reopened.getState().presets[0].codeSnapshots).toEqual(preset.codeSnapshots)
    const before = reopened.getState()
    const changed = styleCodeFixture(); changed.id = 'another'; changed.name = '另一份'
    vi.spyOn(platform.system.fs, 'writeFile').mockRejectedValueOnce(new Error('磁盘只读'))
    // 同内容已落盘可复用；新的摘要写失败时不发布元数据。
    const nextSource = source.source + '\n// changed', nextHash = createHash('sha256').update(nextSource).digest('hex')
    changed.codeSnapshots!.code.codeSources[0] = { hash: nextHash, source: nextSource }
    changed.codeSnapshots!.code.version.files[0].hash = nextHash
    await expect(reopened.getState().saveLibrary({ favorites: [], presets: [changed] })).rejects.toThrow('磁盘只读')
    expect(reopened.getState()).toBe(before)
    expect(disk.getItem(VIDEO_EDIT_EFFECT_LIBRARY_STORAGE_KEY)).toBe(saved)
    await fs.writeFile(path.join(root, 'code-sources', `${source.hash}.js`), 'corrupt')
    const broken = createVideoEditEffectLibraryStore(disk, desktopEffectLibrarySources)
    await expect(broken.getState().ready()).rejects.toThrow()
    await expect(broken.getState().deletePreset(preset.id)).rejects.toThrow()
    expect(disk.getItem(VIDEO_EDIT_EFFECT_LIBRARY_STORAGE_KEY)).toBe(saved)
  } finally { vi.restoreAllMocks(); uninstallHarnessNativeStorage(); await env.cleanup(); await fs.rm(root, { recursive: true, force: true }) }
})
