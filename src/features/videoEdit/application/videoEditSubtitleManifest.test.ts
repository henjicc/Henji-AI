import { expect, it, vi } from 'vitest'
import { SUBTITLE_MANIFEST_VERSION } from '@/core/persistence/preferenceSchemas'
import { readVideoEditSubtitleManifest } from './videoEditSubtitleManifest'

const boundary = vi.hoisted(() => ({ text: '', backups: new Map<string, Uint8Array>(), mkdir: vi.fn() }))
vi.mock('@/platform/runtime', () => ({ getPlatform: () => ({ system: { fs: {
  readTextFile: async () => boundary.text,
  mkdir: boundary.mkdir,
  writeFile: async (path: string, bytes: Uint8Array) => { boundary.backups.set(path, bytes) },
  readFile: async (path: string) => boundary.backups.get(path),
  exists: async (path: string) => boundary.backups.has(path),
} } }) }))

it('共享读取预检版本、备份原文、迁移校验；未来版或无效内容不能进入恢复', async () => {
  const path = 'D:/mix.wav.subtitle.json'
  const manifest = { version: 1, projectId: 'project', sequenceId: 'sequence', signature: 'saved-sound', startFrame: 0, endFrame: 30 }
  boundary.text = JSON.stringify({ ...manifest, version: SUBTITLE_MANIFEST_VERSION + 1 })
  await expect(readVideoEditSubtitleManifest(path)).rejects.toThrow()
  expect(boundary.mkdir).not.toHaveBeenCalled()
  boundary.text = JSON.stringify(manifest)
  const snapshot = boundary.text
  expect(await readVideoEditSubtitleManifest(path)).toMatchObject({ ...manifest, version: SUBTITLE_MANIFEST_VERSION })
  expect(new TextDecoder().decode([...boundary.backups.values()][0])).toBe(snapshot)
  expect(boundary.text).toBe(snapshot)
  boundary.text = JSON.stringify({ ...manifest, version: SUBTITLE_MANIFEST_VERSION, endFrame: 'invalid' })
  await expect(readVideoEditSubtitleManifest(path)).rejects.toThrow()
})
