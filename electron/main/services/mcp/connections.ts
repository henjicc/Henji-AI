import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { McpConnectionInfo } from '../../../../src/core/application-control/localHostContracts'

const recordSchema = z.object({ id: z.string().uuid(), name: z.string().min(1).max(80), expiresAt: z.number(), token: z.string().length(64) }).strict()
const storageSchema = z.object({ version: z.literal(1), connections: z.array(recordSchema).max(32) }).strict()
type Connection = z.infer<typeof recordSchema>
export interface ConnectionStorage { read(): string | null; write(value: string): void }

/** 主进程所有；网络客户端只能提交令牌，不能提交权限或授权对象。 */
export class McpConnections {
  private records: Connection[] | undefined
  constructor(private readonly storage: ConnectionStorage, private readonly now = Date.now) {}
  private load(): Connection[] {
    if (!this.records) {
      const saved = this.storage.read()
      this.records = saved ? storageSchema.parse(JSON.parse(saved)).connections : []
    }
    return this.records
  }
  private save(records: Connection[]): void {
    this.storage.write(JSON.stringify({ version: 1, connections: records }))
    this.records = records
  }
  list(): McpConnectionInfo[] { return this.load().map(({ id, name, expiresAt }) => ({ id, name, expiresAt })) }
  create(name: string): McpConnectionInfo {
    const records = this.load().filter((record) => record.expiresAt > this.now())
    if (records.length >= 32) throw new Error('连接数量已达上限，请先撤销不再使用的连接。')
    const record = recordSchema.parse({ id: randomUUID(), name: name.trim(), expiresAt: this.now() + 30 * 24 * 60 * 60 * 1000, token: randomBytes(32).toString('hex') })
    this.save([...records, record])
    return { id: record.id, name: record.name, expiresAt: record.expiresAt }
  }
  assertActive(id: string): void {
    if (!this.load().some((record) => record.id === id && record.expiresAt > this.now())) throw new Error('连接已撤销或过期，请在应用中重新授权。')
  }
  authenticate(token: string): string | null {
    if (!/^[a-f0-9]{64}$/.test(token)) return null
    return this.load().find((record) => record.expiresAt > this.now() && timingSafeEqual(Buffer.from(token), Buffer.from(record.token)))?.id ?? null
  }
  token(id: string): string {
    this.assertActive(id)
    return this.load().find((record) => record.id === id)!.token
  }
  revoke(id: string): void { this.save(this.load().filter((record) => record.id !== id)) }
}
