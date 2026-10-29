import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('../image-editor-v3/resource-media-url', () => ({ resolveImageEditorV3ResourceMediaUrl: vi.fn() }))
import { collectUnreferencedMedia, type MediaReferenceProvider, type RecycleCandidate } from './collector'
import { canonicalPath, fileIdentity } from './paths'
import { scanReferenceFiles } from './file-scanner'
import { MediaRecycleDeadline } from './lifecycle'

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
    trashItem: file => fs.rename(file, `${file}.trashed`),
    store: { candidates: async function* () { yield* pending.values() }, identity: candidate => candidate === key ? identity : undefined, forget: id => { pending.delete(id) } },
  }, new AbortController().signal)
  return { root, file, pending, sweep }
}

describe('global media reclamation', () => {
  it('回收前核验期间到达截止时不计作删除失败', async () => {
    const { root, file, pending } = await fixture()
    const key = (await canonicalPath(file))!; const identity = fileIdentity(await fs.stat(file))
    const controller = new AbortController(); const log = vi.fn(); const trashItem = vi.fn()
    const original = fs.realpath.bind(fs); let reads = 0
    const realpath = vi.spyOn(fs, 'realpath').mockImplementation(async target => {
      if (target === file && ++reads === 2) controller.abort(new MediaRecycleDeadline())
      return original(target)
    })
    try {
      const summary = await collectUnreferencedMedia({ roots: async () => [root], revision: () => 'stable', log, trashItem,
        providers: [{ id: 'documents', collect: async () => [] }],
        store: { candidates: async function* () { yield* pending.values() }, identity: candidate => candidate === key ? identity : undefined, forget: id => { pending.delete(id) } },
      }, controller.signal)
      expect(summary.retained['delete-failed']).toBeUndefined()
      expect(log).toHaveBeenLastCalledWith('deferred', summary)
      expect(trashItem).not.toHaveBeenCalled()
      expect(pending.size).toBe(1)
    } finally { realpath.mockRestore() }
  })

  it('重复候选只回收一次，时间片结束保留未处理队列，下一轮可以继续', async () => {
    const { root, file, pending } = await fixture()
    const next = path.join(root, 'next.png'); await fs.writeFile(next, 'next')
    pending.set(1, { id: 1, paths: [file, file] })
    pending.set(2, { id: 2, paths: [next] })
    const controller = new AbortController(); const log = vi.fn()
    const trashItem = vi.fn(async (target: string) => { await fs.rename(target, `${target}.trashed`) })
    const identities = new Map(await Promise.all([file, next].map(async target => [(await canonicalPath(target))!, fileIdentity(await fs.stat(target))] as const)))
    const options = {
      roots: async () => [root], revision: () => 'stable', log, trashItem,
      providers: [{ id: 'documents', collect: async () => [] }],
      store: { candidates: async function* () { yield* pending.values() }, identity: (key: string) => identities.get(key), forget: (id: number) => { pending.delete(id); if (id === 1) controller.abort(new MediaRecycleDeadline()) } },
    }
    const first = await collectUnreferencedMedia(options, controller.signal)
    expect(first.deleted).toBe(1)
    expect(trashItem).toHaveBeenCalledOnce()
    expect(log).toHaveBeenLastCalledWith('deferred', first)
    expect([...pending.keys()]).toEqual([2])
    expect(await fs.readFile(`${file}.trashed`, 'utf8')).toBe('generated')
    const second = await collectUnreferencedMedia(options, new AbortController().signal)
    expect(second.deleted).toBe(1)
    expect(pending.size).toBe(0)
    expect(log).toHaveBeenLastCalledWith('completed', second)
  })

  it.each(['alias', 'replacement'])('候选筛选后目录别名或文件身份改变时不回收：%s', async change => {
    const { root, file, pending } = await fixture()
    const key = (await canonicalPath(file))!; const identity = fileIdentity(await fs.stat(file))
    const original = fs.realpath.bind(fs); let reads = 0
    const realpath = vi.spyOn(fs, 'realpath').mockImplementation(async target => {
      if (target === file && ++reads > 1) {
        if (change === 'alias') return path.join(root, '..', 'external.png')
        await fs.writeFile(file, 'replacement by another owner')
      }
      return original(target)
    })
    const trashItem = vi.fn()
    try {
      const summary = await collectUnreferencedMedia({ roots: async () => [root], revision: () => 'stable', log: vi.fn(), trashItem,
        providers: [{ id: 'documents', collect: async () => [] }],
        store: { candidates: async function* () { yield* pending.values() }, identity: candidate => candidate === key ? identity : undefined, forget: id => { pending.delete(id) } },
      }, new AbortController().signal)
      expect(summary.retained).toEqual({ 'identity-changed': 1 })
      expect(trashItem).not.toHaveBeenCalled()
      expect(pending.size).toBe(1)
    } finally { realpath.mockRestore() }
  })

  it('reclaims an unused output even when another input in the same deleted history record is still referenced', async () => {
    const { root, file, pending, sweep } = await fixture()
    const input = path.join(root, 'input.png')
    await fs.writeFile(input, 'referenced input')
    pending.set(1, { id: 1, paths: [input, file] })
    expect((await sweep([{ id: 'canvas', collect: async () => [input] }])).deleted).toBe(1)
    expect(await fs.readFile(input, 'utf8')).toBe('referenced input')
    await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await fs.readFile(`${file}.trashed`, 'utf8')).toBe('generated')
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
    const doc = path.join(root, 'canvas.hjcvs')
    await fs.writeFile(doc, JSON.stringify({ content: { nodes: [{ data: { imageUrl: file } }] } }))
    const refs: string[] = []
    await scanReferenceFiles([{ path: doc }], ['.hjcvs'], new AbortController().signal, async (_file, paths) => { refs.push(...paths) })
    expect(refs).toContain(file)
    await fs.writeFile(doc, '{')
    await expect(scanReferenceFiles([{ path: doc }], ['.hjcvs'], new AbortController().signal, async () => undefined)).rejects.toThrow()
  })
})
