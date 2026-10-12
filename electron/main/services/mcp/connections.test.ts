import { describe, expect, it } from 'vitest'
import { McpConnections } from './connections'
import { MCP_CONNECTION_DAY_MS as DAY, MCP_CONNECTION_LIFETIME_MS } from '../../../../src/core/application-control/mcpConnectionExpiry'

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
  it('过期保留 30 天可续期；新建不提前删除，满 30 天清理且撤销立即删除', () => {
    let now = Date.now()
    let saved: string | null = null
    const storage = { read: () => saved, write: (value: string) => { saved = value } }
    const connections = new McpConnections(storage, () => now)
    const connection = connections.create('保留期限')
    const token = connections.token(connection.id)
    now = connection.expiresAt
    connections.create('新建')
    expect(new McpConnections(storage, () => now).authenticate(token)).toMatchObject({ status: 'expired', connectionId: connection.id })
    now += 30 * DAY - 1
    expect(connections.list().some(item => item.id === connection.id)).toBe(true)
    now += 1
    expect(connections.list().some(item => item.id === connection.id)).toBe(false)
    expect(new McpConnections(storage, () => now).authenticate(token)).toEqual({ status: 'unknown' })
    expect(() => connections.renew(connection.id)).toThrow('超过续期期限')
    const revoked = connections.create('撤销')
    const revokedToken = connections.token(revoked.id)
    connections.revoke(revoked.id)
    expect(new McpConnections(storage, () => now).authenticate(revokedToken)).toEqual({ status: 'unknown' })
  })
  it('到期两种提醒按连接和本次期限持久去重，续期只改期限且重新提醒', () => {
    let now = Date.now()
    let saved: string | null = null
    const storage = { read: () => saved, write: (value: string) => { saved = value } }
    const connections = new McpConnections(storage, () => now)
    const original = connections.create('续期与提醒', { allowWrites: true, allowPaid: true, allowDestructive: true })
    const token = connections.token(original.id)
    const other = connections.create('独立连接')
    now = original.expiresAt - 3 * DAY
    expect(connections.list()[0].reminder).toBe('expiring')
    expect(connections.acknowledgeReminder(original.id, original.expiresAt, 'expiring')).toBe(true)
    expect(connections.acknowledgeReminder(original.id, original.expiresAt, 'expiring')).toBe(false)
    expect(new McpConnections(storage, () => now).list()[0].reminder).toBeUndefined()
    expect(connections.list().find(item => item.id === other.id)?.reminder).toBe('expiring')
    now = original.expiresAt
    expect(connections.list()[0].reminder).toBe('expired')
    expect(connections.acknowledgeReminder(original.id, original.expiresAt, 'expired')).toBe(true)
    expect(new McpConnections(storage, () => now).list()[0].reminder).toBeUndefined()
    const before = JSON.parse(saved!).connections[0]
    const renewed = connections.renew(original.id)
    const after = JSON.parse(saved!).connections[0]
    expect(after).toEqual({ ...before, expiresAt: now + MCP_CONNECTION_LIFETIME_MS })
    expect(renewed.reminder).toBeUndefined()
    expect(connections.token(original.id)).toBe(token)
    expect(connections.acknowledgeReminder(original.id, original.expiresAt, 'expired')).toBe(false)
    now = renewed.expiresAt - 3 * DAY
    expect(new McpConnections(storage, () => now).list()[0].reminder).toBe('expiring')
  })
})
