import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ root: '' }))
vi.mock('../db', () => ({ getHenjiDataDir: () => state.root }))
beforeEach(async () => { vi.resetModules(); state.root = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-root-records-')) })
afterEach(async () => { vi.useRealTimers(); await fsp.rm(state.root, { recursive: true, force: true }) })

it('无法读取的原授权记录不会被本次新授权覆盖', async () => {
  const file = path.join(state.root, 'allowed-media-roots.json')
  const original = JSON.stringify({ version: 2, roots: [] })
  await fsp.writeFile(file, original)
  const grants = await import('./rootGrants')
  vi.useFakeTimers()
  grants.restorePersistedMediaRoots(vi.fn())
  grants.persistMediaRootGrant(path.join(state.root, 'new'))
  await vi.advanceTimersByTimeAsync(501)
  expect(await fsp.readFile(file, 'utf8')).toBe(original)
}, 20_000)

it('授权记录不因数量增长而截断', async () => {
  const file = path.join(state.root, 'allowed-media-roots.json')
  const grants = await import('./rootGrants')
  vi.useFakeTimers()
  grants.restorePersistedMediaRoots(vi.fn())
  for (let index = 0; index < 150; index++) grants.persistMediaRootGrant(path.join(state.root, String(index)))
  await vi.advanceTimersByTimeAsync(501)
  vi.useRealTimers()
  // Timer dispatch starts asynchronous I/O; wait for that exact publication (slow under parallel suites).
  await vi.waitFor(async () => {
    const value = JSON.parse(await fsp.readFile(file, 'utf8')) as { version: number; roots: unknown[] }
    expect(value.version).toBe(1); expect(value.roots).toHaveLength(150)
  }, { timeout: 10_000, interval: 50 })
}, 20_000)
