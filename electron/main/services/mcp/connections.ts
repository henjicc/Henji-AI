import { mcpConnectionRecordSchema as recordSchema, mcpConnectionStorageSchema as storageSchema } from '../../../../src/core/persistence/mcpConnectionSchema'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { McpConnectionInfo } from '../../../../src/core/application-control/localHostContracts'
import { MCP_CONNECTION_LIFETIME_MS, mcpConnectionExpiryState, type McpConnectionReminderState } from '../../../../src/core/application-control/mcpConnectionExpiry'

type Connection = z.infer<typeof recordSchema>
export interface ConnectionStorage { read(): string | null; write(value: string): void }
export type McpAuthentication = { status: 'valid' | 'expired'; connectionId: string; expiresAt: number } | { status: 'unknown' }

/** 主进程所有；网络客户端只能提交令牌，不能提交权限或授权对象。 */
export class McpConnections {
  private records: Connection[] | undefined
  constructor(private readonly storage: ConnectionStorage, private readonly now = Date.now) {}
  private load(): Connection[] {
    if (!this.records) {
      const saved = this.storage.read()
      this.records = saved ? storageSchema.parse(JSON.parse(saved)).connections : []
    }
    const retained = this.records.filter(record => record.expiresAt + MCP_CONNECTION_LIFETIME_MS > this.now())
    if (retained.length !== this.records.length) this.save(retained)
    return this.records
  }
  private save(records: Connection[]): void {
    this.storage.write(JSON.stringify({ version: 1, connections: records }))
    this.records = records
  }
  list(): McpConnectionInfo[] {
    return this.load().map(({ id, name, expiresAt, allowWrites, allowDestructive, allowPaid, reminders }) => {
      const state = mcpConnectionExpiryState(expiresAt, this.now())
      const reminder = state !== 'active' && !(reminders?.expiresAt === expiresAt && reminders.states.includes(state)) ? state : undefined
      return { id, name, expiresAt, allowWrites, allowDestructive, allowPaid, ...(reminder ? { reminder } : {}) }
    })
  }
  access(id: string): { allowWrites: boolean; allowDestructive: boolean; allowPaid: boolean } {
    this.assertActive(id)
    const record = this.load().find((item) => item.id === id)!
    return { allowWrites: record.allowWrites, allowPaid: record.allowWrites && record.allowPaid, allowDestructive: record.allowWrites && record.allowDestructive }
  }
  create(name: string, access: { allowWrites?: boolean; allowDestructive?: boolean; allowPaid?: boolean } = {}): McpConnectionInfo {
    const records = this.load()
    const record = recordSchema.parse({ id: randomUUID(), name: name.trim(), expiresAt: this.now() + MCP_CONNECTION_LIFETIME_MS, token: randomBytes(32).toString('hex'), allowWrites: access.allowWrites ?? false, allowPaid: access.allowWrites === true && access.allowPaid === true, allowDestructive: access.allowWrites === true && access.allowDestructive === true })
    this.save([...records, record])
    return { id: record.id, name: record.name, expiresAt: record.expiresAt, allowWrites: record.allowWrites, allowDestructive: record.allowDestructive, allowPaid: record.allowPaid }
  }
  assertActive(id: string): void {
    if (!this.load().some((record) => record.id === id && record.expiresAt > this.now())) throw new Error('连接已撤销或过期，请在应用中重新授权。')
  }
  authenticate(token: string): McpAuthentication {
    if (!/^[a-f0-9]{64}$/.test(token)) return { status: 'unknown' }
    const record = this.load().find((record) => timingSafeEqual(Buffer.from(token), Buffer.from(record.token)))
    return record ? { status: record.expiresAt > this.now() ? 'valid' : 'expired', connectionId: record.id, expiresAt: record.expiresAt } : { status: 'unknown' }
  }
  renew(id: string): McpConnectionInfo {
    const records = this.load()
    if (!records.some(record => record.id === id)) throw new Error('连接已撤销或超过续期期限，请重新授权。')
    this.save(records.map(record => record.id === id ? { ...record, expiresAt: this.now() + MCP_CONNECTION_LIFETIME_MS } : record))
    return this.list().find(record => record.id === id)!
  }
  acknowledgeReminder(id: string, expiresAt: number, state: McpConnectionReminderState): boolean {
    const records = this.load()
    const record = records.find(item => item.id === id)
    // 提醒显示期间发生续期或撤销时，旧提醒不能标记新授权。
    if (!record || record.expiresAt !== expiresAt || mcpConnectionExpiryState(expiresAt, this.now()) !== state) return false
    const states = record.reminders?.expiresAt === expiresAt ? record.reminders.states : []
    if (states.includes(state)) return false
    this.save(records.map(item => item.id === id ? { ...item, reminders: { expiresAt, states: [...states, state] } } : item))
    return true
  }
  token(id: string): string {
    this.assertActive(id)
    return this.load().find((record) => record.id === id)!.token
  }
  revoke(id: string): void { this.save(this.load().filter((record) => record.id !== id)) }
}
