import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createWaveformDiskCache } from './waveform-cache'

const key = (digit: string): string => digit.repeat(64)
const directories: string[] = []
async function directory(): Promise<string> {
  const value = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-waveform-disk-'))
  directories.push(value)
  return value
}
afterEach(async () => { await Promise.all(directories.splice(0).map(value => fs.rm(value, { recursive: true, force: true }))) })

describe('waveform disk cache', () => {
  it('writes atomically, reads back, refuses foreign keys and treats a missing directory as disabled', async () => {
    const root = path.join(await directory(), 'nested')
    const cache = createWaveformDiskCache({ directory: () => root })
    expect(await cache.read(key('a'))).toBeUndefined()
    await cache.write(key('a'), Uint8Array.of(1, 2, 3))
    expect([...(await cache.read(key('a')))!]).toEqual([1, 2, 3])
    expect((await fs.readdir(root)).filter(name => name.endsWith('.tmp'))).toEqual([])
    await expect(cache.read('../escape')).rejects.toThrow('缓存键')
    const disabled = createWaveformDiskCache({ directory: () => undefined })
    await disabled.write(key('b'), Uint8Array.of(1))
    expect(await disabled.read(key('b'))).toBeUndefined()
  })
  it('evicts the least recently used files above the budget and removes stale temporary files', async () => {
    const root = await directory()
    const cache = createWaveformDiskCache({ directory: () => root, budgetBytes: 2500 })
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
})
