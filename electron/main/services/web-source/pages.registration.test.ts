import path from 'node:path'
import { expect, it, vi } from 'vitest'
import type { VideoFrameTarget } from '../video-decoder'
import type { WebCacheRegistrations } from './registration'
import { WebSourcePages } from './pages'

const boundary = vi.hoisted(() => ({ changed: undefined as undefined | ((root: string, hash: string, paths: string[]) => void), register: vi.fn(), remove: vi.fn() }))
vi.mock('./site', () => ({ resolveWebSourceFolder: async (root: string) => ({ root }) }))
vi.mock('./content', () => ({ WebSourceContent: class {
  constructor(changed: typeof boundary.changed) { boundary.changed = changed }
  hold() {} release() {} dispose() {} async current() { return 'first' }
} }))
vi.mock('./page', () => ({ WebSourcePage: class {
  pixelWidth = 100; pixelHeight = 100; duration = 1; capturePath = {}; signal = new AbortController().signal
  constructor(readonly streamId: string, readonly target: VideoFrameTarget, readonly route: string, readonly folder: { root: string }, readonly view: unknown, public contentHash: string) {}
  async open() {} close() {} async reload(hash: string) { this.contentHash = hash }
} }))

it('热更新成功后以原标记重判新内容，关页撤销登记', async () => {
  const registration = { register: boundary.register, remove: boundary.remove, dispose: vi.fn() } as unknown as WebCacheRegistrations
  const pages = new WebSourcePages({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() }, vi.fn(), registration)
  const root = path.resolve('web-fixture')
  const trust = [{ id: 'origin', sourceName: '原网页来源', sourceType: 'project' as const }]
  const target = { id: 1, isDestroyed: () => false, onGone: () => () => undefined } as unknown as VideoFrameTarget
  try {
    const opened = await pages.open(target, { route: 'r', path: root, width: 100, height: 100, region: [0, 0, 100, 100], scale: 1, trust })
    boundary.changed!(root, 'second', [root])
    await vi.waitFor(() => expect(boundary.register).toHaveBeenCalledTimes(2))
    expect(boundary.register.mock.calls[1][0].contentHash).toBe('second')
    expect(boundary.register.mock.calls[1][1]).toEqual(trust)
    pages.close(1, opened.streamId)
    expect(boundary.remove).toHaveBeenLastCalledWith(opened.streamId)
  } finally { pages.dispose() }
})
