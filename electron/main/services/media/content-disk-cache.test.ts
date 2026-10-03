import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createContentDiskCache } from './content-disk-cache'

const key = (digit: string): string => digit.repeat(64)
const directories: string[] = []
async function directory(): Promise<string> {
  const value = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-content-disk-'))
  directories.push(value)
  return value
}
afterEach(async () => { await Promise.all(directories.splice(0).map(value => fs.rm(value, { recursive: true, force: true }))) })

describe('content disk cache', () => {
  it('writes atomically, reads back, refuses foreign keys and treats a missing directory as disabled', async () => {
    const root = path.join(await directory(), 'nested')
    const cache = createContentDiskCache({ directory: () => root, extension: '.hwpk' })
    expect(await cache.read(key('a'))).toBeUndefined()
    await cache.write(key('a'), Uint8Array.of(1, 2, 3))
    expect([...(await cache.read(key('a')))!]).toEqual([1, 2, 3])
    expect((await fs.readdir(root)).filter(name => name.endsWith('.tmp'))).toEqual([])
    await expect(cache.read('../escape')).rejects.toThrow('缓存键')
    const disabled = createContentDiskCache({ directory: () => undefined, extension: '.hwpk' })
    await disabled.write(key('b'), Uint8Array.of(1))
    expect(await disabled.read(key('b'))).toBeUndefined()
  })
  it('evicts the least recently used files above the budget and removes stale temporary files', async () => {
    const root = await directory()
    const cache = createContentDiskCache({ directory: () => root, extension: '.hwpk', budgetBytes: 2500 })
    const old = new Date(Date.now() - 60 * 60 * 1000)
    for (const [index, digit] of ['1', '2', '3'].entries()) {
      await fs.writeFile(path.join(root, `${key(digit)}.hwpk`), Buffer.alloc(1000))
      const used = new Date(old.getTime() + index * 1000)
      await fs.utimes(path.join(root, `${key(digit)}.hwpk`), used, used)
    }
    await fs.writeFile(path.join(root, `${key('9')}.hwpk.x.tmp`), Buffer.alloc(10))
    await fs.utimes(path.join(root, `${key('9')}.hwpk.x.tmp`), old, old)
    // Reading the oldest file makes it the most recently used.
    expect(await cache.read(key('1'))).toBeDefined()
    await new Promise(resolve => setTimeout(resolve, 50))
    const result = await cache.prune()
    expect(result.bytes).toBeLessThanOrEqual(2000)
    const left = (await fs.readdir(root)).sort()
    expect(left).toContain(`${key('1')}.hwpk`)
    expect(left).not.toContain(`${key('2')}.hwpk`)
    expect(left.some(name => name.endsWith('.tmp'))).toBe(false)
  })
  it('locates and touches existing entries, adopts external temporary files and throttles pruning between writes', async () => {
    const root = await directory()
    const cache = createContentDiskCache({ directory: () => root, extension: '.webp', pruneIntervalMs: 60_000 })
    expect(await cache.locate(key('c'))).toBeUndefined()
    const temporary = (await cache.prepareTemporary(key('c')))!
    expect(path.dirname(temporary)).toBe(root)
    await fs.writeFile(temporary, Buffer.from('frame'))
    const adopted = await cache.adopt(key('c'), temporary)
    expect(adopted).toBe(path.join(root, `${key('c')}.webp`))
    const old = new Date(Date.now() - 60 * 60 * 1000)
    await fs.utimes(adopted, old, old)
    expect(await cache.locate(key('c'))).toBe(adopted)
    expect((await fs.stat(adopted)).mtimeMs).toBeGreaterThan(old.getTime() + 1000)
    // A temporary file of another key cannot be adopted (it would publish the wrong frame).
    const foreign = (await cache.prepareTemporary(key('d')))!
    await fs.writeFile(foreign, Buffer.from('x'))
    await expect(cache.adopt(key('c'), foreign)).rejects.toThrow('临时文件')
    // Empty outputs are never reported as hits.
    await fs.writeFile(path.join(root, `${key('e')}.webp`), Buffer.alloc(0))
    expect(await cache.locate(key('e'))).toBeUndefined()
    // Stale temporary files survive until the throttled prune runs explicitly.
    await fs.utimes(foreign, old, old)
    await cache.write(key('f'), Uint8Array.of(1))
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(await fs.readdir(root)).toContain(path.basename(foreign))
    await cache.prune()
    expect(await fs.readdir(root)).not.toContain(path.basename(foreign))
  })
})
