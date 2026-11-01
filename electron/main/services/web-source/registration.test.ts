import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import type { WebSourcePage } from './page'
import { WebCacheRegistrations } from './registration'
import { webSourceContentHash } from './site'
import { webSourceSession } from './session'
import { WebCacheFonts } from './fonts'

vi.mock('./session', () => ({ webSourceSession: vi.fn() }))
vi.mock('../../protocol', () => ({ inferMimeFromPath: () => 'text/html' }))
const roots: string[] = [], registries: WebCacheRegistrations[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const registry of registries.splice(0)) registry.dispose(); for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })

it('后台只接收已批准标记，一次许可绑定宿主、来源代次，关页重开不扩大且全局允许可恢复', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'web-registration-')); roots.push(root)
  await fs.writeFile(path.join(root, 'index.html'), 'one')
  let allowed = false, policy = false
  const logger = { info: vi.fn(), warn: vi.fn() }
  const registry = new WebCacheRegistrations({ policy: () => policy, allows: () => policy || allowed }, logger); registries.push(registry)
  const gone = new Map<number, () => void>()
  const page = (id: string, owner: number, hash: string): WebSourcePage => ({ streamId: id, folder: { root }, contentHash: hash, signal: new AbortController().signal,
    target: { id: owner, isDestroyed: () => false, onGone: (callback: () => void) => { gone.set(owner, callback); return () => undefined } } }) as unknown as WebSourcePage
  const foreign = [{ id: 'external', sourceType: 'project' as const, sourceName: '外部工程' }]
  const hash = await webSourceContentHash(root)
  await registry.register(page('unconfirmed', 1, hash), foreign)
  expect(registry.get('unconfirmed')).toBeUndefined()
  allowed = true
  await registry.register(page('missing-context', 1, hash), undefined)
  expect(registry.get('missing-context')).toBeUndefined()
  await registry.register(page('first', 1, hash), foreign)
  const granted = registry.get('first')!
  expect(granted.current).toBe(true)
  await registry.register(page('other-host', 2, hash), foreign)
  expect(registry.get('other-host')).toBeUndefined()
  registry.remove('first')
  expect(granted.signal.aborted).toBe(true)
  await registry.register(page('same-host', 1, hash), foreign)
  expect(registry.get('same-host')?.current).toBe(true)
  await fs.writeFile(path.join(root, 'index.html'), 'two')
  await vi.waitFor(() => expect(granted.batch.current).toBe(false))
  await fs.writeFile(path.join(root, 'index.html'), 'one')
  await registry.register(page('reverted', 1, hash), foreign)
  expect(registry.get('reverted')).toBeUndefined()
  gone.get(1)!()
  expect(registry.get('same-host')).toBeUndefined()
  await registry.register(page('same-id-new-host-session', 1, hash), foreign)
  expect(registry.get('same-id-new-host-session')).toBeUndefined()
  await registry.register(page('local-new-host-session', 1, hash), [])
  expect(registry.get('local-new-host-session')?.current).toBe(true)
  policy = true
  await registry.register(page('always', 2, hash), foreign)
  expect(registry.get('always')?.current).toBe(true)
})

it('登记异步散列期间页面关闭，不留下可执行的后台许可', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'web-registration-close-')); roots.push(root)
  await fs.writeFile(path.join(root, 'index.html'), 'one')
  const registry = new WebCacheRegistrations({ policy: () => false, allows: () => true }, { info: vi.fn(), warn: vi.fn() }); registries.push(registry)
  const lifetime = new AbortController()
  const page = { streamId: 'closing', folder: { root }, contentHash: await webSourceContentHash(root), signal: lifetime.signal,
    target: { id: 1, isDestroyed: () => false, onGone: () => () => undefined } } as unknown as WebSourcePage
  const pending = registry.register(page, [])
  lifetime.abort()
  await pending
  expect(registry.get('closing')).toBeUndefined()
})

it('字体异步复核期间发生存储变更，最后一次环境校验也必须拒绝', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'web-environment-race-')); roots.push(root)
  await fs.writeFile(path.join(root, 'index.html'), 'one')
  const registry = new WebCacheRegistrations({ policy: () => false, allows: () => true }, { info: vi.fn(), warn: vi.fn() }); registries.push(registry)
  const page = { streamId: 'race', folder: { root }, contentHash: await webSourceContentHash(root), signal: new AbortController().signal,
    validateEnvironment: async () => true, target: { id: 1, isDestroyed: () => false, onGone: () => () => undefined } } as unknown as WebSourcePage
  const state = { storageSignature: 'initial', partition: 'partition', reason: undefined }
  vi.mocked(webSourceSession).mockReturnValue(state as unknown as ReturnType<typeof webSourceSession>)
  const fonts = { current: true, signature: 'fonts', check: vi.fn(async () => true), close: vi.fn() }
  vi.spyOn(WebCacheFonts, 'begin').mockResolvedValue(fonts as unknown as WebCacheFonts)
  await registry.register(page, [])
  const environment = await registry.get('race')!.environment()
  let finish!: (result: boolean) => void
  fonts.check.mockImplementation(() => new Promise<boolean>(resolve => { finish = resolve }))
  const checking = environment!.current()
  state.storageSignature = 'changed-during-await'
  finish(true)
  expect(await checking).toBe(false)
  environment!.close()
})
