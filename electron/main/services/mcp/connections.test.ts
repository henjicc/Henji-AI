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
    expect(restored.authenticate(aToken)).toMatchObject({ status: 'valid', connectionId: a.id })
    expect(restored.authenticate(bToken)).toMatchObject({ status: 'valid', connectionId: b.id })
    expect(restored.list()[0]).not.toHaveProperty('token')
    restored.revoke(a.id)
    expect(new McpConnections(storage).authenticate(aToken)).toEqual({ status: 'unknown' })
    expect(new McpConnections(storage).authenticate(bToken)).toMatchObject({ status: 'valid', connectionId: b.id })
  })
  it('两个实例共用同一份授权：一方的新授权与撤销另一方立即生效，各自新增不互相抹掉', () => {
    let saved: string | null = null
    const storage = { read: () => saved, write: (value: string) => { saved = value } }
    const serving = new McpConnections(storage)
    const other = new McpConnections(storage)
    expect(serving.list()).toEqual([])
    const a = other.create('甲')
    expect(serving.authenticate(other.token(a.id))).toMatchObject({ status: 'valid', connectionId: a.id })
    const b = serving.create('乙')
    expect(other.list().map(item => item.id)).toEqual([a.id, b.id])
    other.revoke(a.id)
    expect(() => serving.assertActive(a.id)).toThrow()
    expect(serving.list().map(item => item.id)).toEqual([b.id])
  })
  it('保存失败不发出未持久化的新授权；非法存储不得默认授权', () => {
    const failing = new McpConnections({ read: () => null, write: () => { throw new Error('disk full') } })
    expect(() => failing.create('甲')).toThrow('disk full')
    expect(failing.list()).toEqual([])
    expect(() => new McpConnections({ read: () => '{"connections":[]}', write: () => {} }).list()).toThrow()
  })
  it('旧版带到期时间的授权迁移为永久有效，令牌不变并移除权限位', () => {
    const token = 'a'.repeat(64)
    let saved: string | null = JSON.stringify({ version: 1, connections: [{ id: '00000000-0000-4000-8000-000000000001', name: '旧连接', expiresAt: 1, token, allowWrites: true, allowDestructive: true, allowPaid: false, reminders: { expiresAt: 1, states: ['expired'] } }] })
    const connections = new McpConnections({ read: () => saved, write: (value) => { saved = value } })
    expect(connections.authenticate(token)).toEqual({ status: 'valid', connectionId: '00000000-0000-4000-8000-000000000001' })
    expect(JSON.parse(saved!).version).toBe(1)
    connections.create('另一个客户端')
    expect(JSON.parse(saved!).connections[0]).toEqual({  id: '00000000-0000-4000-8000-000000000001', name: '旧连接', token })
  })

})
