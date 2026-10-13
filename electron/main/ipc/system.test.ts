import { beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ parsers: new Map<string, (input: unknown) => unknown>() }))
vi.mock('electron', () => ({ app: {}, dialog: {}, shell: {} }))
vi.mock('../services/media-recycle/queue', () => ({ registerOwnedMedia: vi.fn() }))
vi.mock('./registry', async (importOriginal) => ({
  ...await importOriginal<typeof import('./registry')>(),
  registerIpcHandler: (channel: string, parser: (input: unknown) => unknown) => { state.parsers.set(channel, parser) },
}))
import { registerSystemIpc } from './system'
beforeEach(() => { state.parsers.clear(); registerSystemIpc() })
describe('HTTP IPC 超时预算', () => {
  it('允许省略或正整数预算，保留其值', () => {
    const parse = state.parsers.get('http:fetch')!
    expect(parse({ url: 'https://example.test', timeoutMs: 10000 })).toMatchObject({ timeoutMs: 10000 })
    expect(parse({ url: 'https://example.test' })).not.toHaveProperty('timeoutMs', 10000)
  })
  it.each([0, -1, 1.5, 300001, null, '10000', Infinity])('拒绝非法预算 %s', (timeoutMs) => {
    expect(() => state.parsers.get('http:fetch')!({ url: 'https://example.test', timeoutMs })).toThrow('timeoutMs')
  })
})
