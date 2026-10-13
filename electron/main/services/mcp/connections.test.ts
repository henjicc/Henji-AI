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
  it('保存失败不发出未持久化的新授权；非法存储不得默认授权', () => {
    const failing = new McpConnections({ read: () => null, write: () => { throw new Error('disk full') } })
    expect(() => failing.create('甲')).toThrow('disk full')
    expect(failing.list()).toEqual([])
    expect(() => new McpConnections({ read: () => '{"connections":[]}', write: () => {} }).list()).toThrow()
  })
  it('旧版带到期时间的授权迁移为永久有效，令牌和权限不变', () => {
    const token = 'a'.repeat(64)
    let saved: string | null = JSON.stringify({ version: 1, connections: [{ id: '00000000-0000-4000-8000-000000000001', name: '旧连接', expiresAt: 1, token, allowWrites: true, allowDestructive: true, allowPaid: false, reminders: { expiresAt: 1, states: ['expired'] } }] })
    const connections = new McpConnections({ read: () => saved, write: (value) => { saved = value } })
    expect(connections.authenticate(token)).toEqual({ status: 'valid', connectionId: '00000000-0000-4000-8000-000000000001' })
    expect(JSON.parse(saved!)).toEqual({ version: 2, connections: [{ id: '00000000-0000-4000-8000-000000000001', name: '旧连接', token, allowWrites: true, allowDestructive: true, allowPaid: false }] })
  })
  it('修改已有连接权限保留令牌，关闭修改时一并收回删除与付费', () => {
    let saved: string | null = null
    const storage = { read: () => saved, write: (value: string) => { saved = value } }
    const connections = new McpConnections(storage)
    const connection = connections.create('权限', { allowWrites: true, allowDestructive: true, allowPaid: true })
    const token = connections.token(connection.id)
    expect(connections.update(connection.id, { allowWrites: true, allowDestructive: false, allowPaid: true })).toMatchObject({ allowDestructive: false, allowPaid: true })
    expect(new McpConnections(storage).access(connection.id)).toEqual({ allowWrites: true, allowDestructive: false, allowPaid: true })
    expect(connections.update(connection.id, { allowWrites: false, allowDestructive: true, allowPaid: true })).toMatchObject({ allowWrites: false, allowDestructive: false, allowPaid: false })
    expect(connections.token(connection.id)).toBe(token)
    connections.revoke(connection.id)
    expect(() => connections.update(connection.id, { allowWrites: true, allowDestructive: false, allowPaid: false })).toThrow('已撤销')
  })
})
