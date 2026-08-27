import type { CredentialStore, MediaReader, RuntimeContext, Transport } from '../../src/runtime'

/**
 * 供应商适配器测试的最小假 `RuntimeContext`：只把 `transport.fetch` 接到测试传入的 mock
 * 函数上（与迁移前 `vi.stubGlobal('fetch', fetchMock)` 语义等价——两者都是"这次网络调用
 * 落到这个 mock 上"），`credentials`/`media` 提供在被测适配器逻辑里不该被调用到的哨兵实现，
 * 一旦哪次改动意外触发了这两者，测试会立刻用明确的错误信息失败，而不是静默返回 `undefined`。
 */
export function fakeRuntimeContext(fetchImpl: Transport['fetch']): RuntimeContext {
  const transport: Transport = { fetch: fetchImpl }
  const credentials: CredentialStore = {
    get: () => {
      throw new Error('credentials.get should not be called by provider adapters under test')
    },
  }
  const media: MediaReader = {
    read: () => {
      throw new Error('media.read should not be called by provider adapters under test')
    },
  }
  return { transport, credentials, media }
}
