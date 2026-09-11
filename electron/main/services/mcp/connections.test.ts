import { describe, expect, it } from 'vitest'
import { McpConnections } from './connections'

describe('连接授权持久化', () => {
  it('重新加载保留独立凭据，撤销不会撤销其他客户端', () => {
    let saved: string | null = null
    const storage = { read: () => saved, write: (value: string) => { saved = value } }
    const first = new McpConnections(storage)
    const a = first.create('甲')
    const b = first.create('乙')
    const aToken = first.token(a.id)
    const bToken = first.token(b.id)
    const restored = new McpConnections(storage)
    expect(restored.authenticate(aToken)).toBe(a.id)
    expect(restored.authenticate(bToken)).toBe(b.id)
    expect(restored.list()[0]).not.toHaveProperty('token')
    restored.revoke(a.id)
    expect(new McpConnections(storage).authenticate(aToken)).toBeNull()
    expect(new McpConnections(storage).authenticate(bToken)).toBe(b.id)
  })
  it('保存失败不发出未持久化的新授权；非法存储不得默认授权', () => {
    const failing = new McpConnections({ read: () => null, write: () => { throw new Error('disk full') } })
    expect(() => failing.create('甲')).toThrow('disk full')
    expect(failing.list()).toEqual([])
    expect(() => new McpConnections({ read: () => '{"connections":[]}', write: () => {} }).list()).toThrow()
  })
})
