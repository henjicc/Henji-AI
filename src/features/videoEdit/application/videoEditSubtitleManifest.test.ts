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

it('共享读取验证当前版本；未来版、无效内容和已放弃的开发版均不改原件', async () => {
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
    await expect(readVideoEditSubtitleManifest(filePath)).rejects.toMatchObject({ code: 'unsupported-version' })
    expect(boundary.text).toBe(original)
    expect(boundary.backups.size).toBe(0)
  }
  expect(boundary.mkdir).not.toHaveBeenCalled()
})
