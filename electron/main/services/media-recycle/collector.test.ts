import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('../image-editor-v3/resource-media-url', () => ({ resolveImageEditorV3ResourceMediaUrl: vi.fn() }))
import { collectUnreferencedMedia, type MediaReferenceProvider, type RecycleCandidate } from './collector'
import { canonicalPath, fileIdentity } from './paths'
import { scanReferenceFiles } from './file-scanner'

const directories: string[] = []
afterEach(async () => { for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }) })
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-recycle-')); directories.push(root)
  const file = path.join(root, 'generated.png'); await fs.writeFile(file, 'generated')
  const key = (await canonicalPath(file))!
  const identity = fileIdentity(await fs.stat(file))
  const pending = new Map<number, RecycleCandidate>([[1, { id: 1, paths: [file] }]])
  const sweep = (providers: MediaReferenceProvider[], timeout = 1000) => collectUnreferencedMedia({
    providers, providerTimeoutMs: timeout, roots: async () => [root], revision: () => 'stable', log: vi.fn(),
    store: { candidates: async function* () { yield* pending.values() }, identity: candidate => candidate === key ? identity : undefined, forget: id => { pending.delete(id) } },
  }, new AbortController().signal)
  return { root, file, pending, sweep }
}

describe('global media reclamation', () => {
  it('reclaims an unused output even when another input in the same deleted history record is still referenced', async () => {
    const { root, file, pending, sweep } = await fixture()
    const input = path.join(root, 'input.png')
    await fs.writeFile(input, 'referenced input')
    pending.set(1, { id: 1, paths: [input, file] })
    expect((await sweep([{ id: 'canvas', collect: async () => [input] }])).deleted).toBe(1)
    expect(await fs.readFile(input, 'utf8')).toBe('referenced input')
    await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('keeps derived media until its source is released', async () => {
    const { root, file, pending, sweep } = await fixture()
    const source = path.join(root, 'source.png')
    pending.set(1, { id: 1, paths: [file], derivedFrom: { [file]: [source] } })
    expect((await sweep([{ id: 'document', collect: async () => [source] }])).deleted).toBe(0)
    expect((await sweep([{ id: 'document', collect: async () => [] }])).deleted).toBe(1)
  })
  it('retains all candidates when any provider fails or times out', async () => {
    const { file, pending, sweep } = await fixture()
    for (const collect of [async (): Promise<string[]> => { throw new Error('Unreadable canvas') }, (): Promise<string[]> => new Promise(() => undefined)]) {
      expect((await sweep([{ id: 'documents', collect }], 10)).deleted).toBe(0)
      expect(pending.size).toBe(1)
      expect((await fs.stat(file)).isFile()).toBe(true)
    }
  })
  it('never deletes an unowned file or a replacement at an owned path', async () => {
    const { root, file, pending, sweep } = await fixture()
    const external = path.join(root, 'imported.png'); await fs.writeFile(external, 'user original')
    pending.set(2, { id: 2, paths: [external] })
    await fs.writeFile(file, 'replacement by another owner')
    expect((await sweep([{ id: 'empty', collect: async () => [] }])).deleted).toBe(0)
    expect(await fs.readFile(external, 'utf8')).toBe('user original')
  })
  it('scans document content off-thread and fails closed on malformed content', async () => {
    const { root, file } = await fixture()
    const doc = path.join(root, 'canvas.henji-canvas')
    await fs.writeFile(doc, JSON.stringify({ content: { nodes: [{ data: { imageUrl: file } }] } }))
    const refs: string[] = []
    await scanReferenceFiles([{ path: doc }], ['.henji-canvas'], new AbortController().signal, async (_file, paths) => { refs.push(...paths) })
    expect(refs).toContain(file)
    await fs.writeFile(doc, '{')
    await expect(scanReferenceFiles([{ path: doc }], ['.henji-canvas'], new AbortController().signal, async () => undefined)).rejects.toThrow()
  })
})
