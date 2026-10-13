import { mcpConnectionRecordSchema as recordSchema, mcpConnectionStorageSchema as storageSchema, migrateMcpConnectionStorageV1 } from '../../../../src/core/persistence/mcpConnectionSchema'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { McpConnectionAccess, McpConnectionInfo } from '../../../../src/core/application-control/localHostContracts'

type Connection = z.infer<typeof recordSchema>
export interface ConnectionStorage { read(): string | null; write(value: string): void }
export type McpAuthentication = { status: 'valid'; connectionId: string } | { status: 'unknown' }

/** 主进程所有；网络客户端只能提交令牌，不能提交权限或授权对象。连接永久有效，直到用户撤销。 */
export class McpConnections {
  private records: Connection[] | undefined
  constructor(private readonly storage: ConnectionStorage) {}
  private load(): Connection[] {
    if (!this.records) {
      const saved = this.storage.read()
      if (!saved) this.records = []
      else {
        const raw = JSON.parse(saved) as { version?: unknown }
        const legacy = raw.version === 1
        const parsed = storageSchema.parse(legacy ? migrateMcpConnectionStorageV1(raw) : raw).connections
        if (legacy) this.save(parsed)
        this.records = parsed
      }
    }
    return this.records
  }
  private save(records: Connection[]): void {
    this.storage.write(JSON.stringify({ version: 2, connections: records }))
    this.records = records
  }
  private info({ id, name, allowWrites, allowDestructive, allowPaid }: Connection): McpConnectionInfo { return { id, name, allowWrites, allowDestructive, allowPaid } }
  private normalize(access: Partial<McpConnectionAccess>): McpConnectionAccess {
    const allowWrites = access.allowWrites ?? false
    return { allowWrites, allowPaid: allowWrites && access.allowPaid === true, allowDestructive: allowWrites && access.allowDestructive === true }
  }
  list(): McpConnectionInfo[] { return this.load().map(record => this.info(record)) }
  access(id: string): McpConnectionAccess {
    this.assertActive(id)
    return this.normalize(this.load().find((item) => item.id === id)!)
  }
  create(name: string, access: Partial<McpConnectionAccess> = {}): McpConnectionInfo {
    const records = this.load()
    const record = recordSchema.parse({ id: randomUUID(), name: name.trim(), token: randomBytes(32).toString('hex'), ...this.normalize(access) })
    this.save([...records, record])
    return this.info(record)
  }
  /** 用户在可信设置页修改已有连接的权限；令牌不变，下一次请求即按新权限执行。 */
  update(id: string, access: McpConnectionAccess): McpConnectionInfo {
    this.assertActive(id)
    const records = this.load().map(record => record.id === id ? { ...record, ...this.normalize(access) } : record)
    this.save(records)
    return this.info(records.find(record => record.id === id)!)
  }
  assertActive(id: string): void {
    if (!this.load().some((record) => record.id === id)) throw new Error('连接已撤销，请在应用中重新授权。')
  }
  authenticate(token: string): McpAuthentication {
    if (!/^[a-f0-9]{64}$/.test(token)) return { status: 'unknown' }
    const record = this.load().find((record) => timingSafeEqual(Buffer.from(token), Buffer.from(record.token)))
    return record ? { status: 'valid', connectionId: record.id } : { status: 'unknown' }
  }
  token(id: string): string {
    this.assertActive(id)
    return this.load().find((record) => record.id === id)!.token
  }
  revoke(id: string): void { this.save(this.load().filter((record) => record.id !== id)) }
}
