import { mcpConnectionRecordSchema as recordSchema, mcpConnectionStorageSchema as storageSchema, migrateMcpConnectionStorageV1, migrateMcpConnectionIdentity } from '../../../../src/core/persistence/mcpConnectionSchema'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { McpConnectionInfo } from '../../../../src/core/application-control/localHostContracts'

type Connection = z.infer<typeof recordSchema>
export interface ConnectionStorage { read(): string | null; write(value: string): void }
export type McpAuthentication = { status: 'valid'; connectionId: string } | { status: 'unknown' }

/**
 * 主进程所有；网络客户端只能提交令牌，不能提交权限或授权对象。连接永久有效，直到用户撤销。
 * 每次都从存储读取：开发版与正式版共用同一份授权，接线员会把外部请求交给其中任何一个，
 * 另一个实例新授权或撤销的连接必须立即生效；存储内容没变时沿用上次的解析结果。
 */
export class McpConnections {
  private cached: { raw: string | null; records: Connection[] } | undefined
  constructor(private readonly storage: ConnectionStorage) {}
  private load(): Connection[] {
    const raw = this.storage.read()
    if (this.cached?.raw === raw) return this.cached.records
    let records: Connection[] = []
    if (raw) {
      const value = JSON.parse(raw) as { version?: unknown }
      records = storageSchema.parse(value.version === 1 ? migrateMcpConnectionIdentity(migrateMcpConnectionStorageV1(value)) : value.version === 2 ? migrateMcpConnectionIdentity(value) : value).connections
    }
    this.cached = { raw, records }
    return records
  }
  /** 修改前总是重新读取最新内容再写回，不会抹掉另一个实例刚写入的记录。 */
  private save(records: Connection[]): void {
    const raw = JSON.stringify({ version: 3, connections: records })
    this.storage.write(raw)
    this.cached = { raw, records }
  }
  private info({ id, name }: Connection): McpConnectionInfo { return { id, name } }
  list(): McpConnectionInfo[] { return this.load().map(record => this.info(record)) }
  create(name: string): McpConnectionInfo {
    const records = this.load()
    const record = recordSchema.parse({ id: randomUUID(), name: name.trim(), token: randomBytes(32).toString('hex') })
    this.save([...records, record])
    return this.info(record)
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
