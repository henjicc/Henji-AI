import { expect, it, vi } from 'vitest'
import path from 'node:path'
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

it('共享读取拒绝未来版和无效内容；旧版升级先备份且不修改原件', async () => {
  const filePath = path.resolve(path.sep, 'mix.wav.subtitle.json')
  const manifest = { version: SUBTITLE_MANIFEST_VERSION, projectId: 'project', sequenceId: 'sequence', signature: 'saved-sound', startFrame: 0, endFrame: 30 }
  boundary.text = JSON.stringify({ ...manifest, version: SUBTITLE_MANIFEST_VERSION + 1 })
  await expect(readVideoEditSubtitleManifest(filePath)).rejects.toThrow()
  expect(boundary.mkdir).not.toHaveBeenCalled()
  boundary.text = JSON.stringify(manifest)
  const snapshot = boundary.text
  expect(await readVideoEditSubtitleManifest(filePath)).toMatchObject({ ...manifest, version: SUBTITLE_MANIFEST_VERSION })
  expect(boundary.backups.size).toBe(0)
  expect(boundary.text).toBe(snapshot)
  boundary.text = JSON.stringify({ ...manifest, version: SUBTITLE_MANIFEST_VERSION, endFrame: 'invalid' })
  await expect(readVideoEditSubtitleManifest(filePath)).rejects.toThrow()
  for (const version of [1, 2, 3]) {
    boundary.text = JSON.stringify({ ...manifest, version })
    const original = boundary.text
    expect(await readVideoEditSubtitleManifest(filePath)).toMatchObject(manifest)
    expect(boundary.text).toBe(original)
    expect([...boundary.backups.values()].map(bytes => new TextDecoder().decode(bytes))).toContain(original)
  }
  expect(boundary.backups.size).toBe(3)
})
