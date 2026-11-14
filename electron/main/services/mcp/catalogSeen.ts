import { z } from 'zod'

export interface CatalogSeenStorage { read(): string | null; write(value: string): void }

const seenSchema = z.object({ callers: z.record(z.string(), z.record(z.string(), z.string())) })

/**
 * 记下每个连接上次 tools/list 拿到的各工具输出结构哈希。客户端按缓存的 outputSchema 校验成功结果，
 * 应用升级或目录变化后它若没重新拉取，成功的写入会被它判成失败、助手再写一遍；
 * 所以输出结构已变的工具在执行前就拒绝并说明“未执行、请重新拉取”。
 * 记录跟着授权存储一起跨重启保留；读不出来时当作不知道，不拦任何调用。
 */
export class McpCatalogSeen {
  constructor(private readonly storage: CatalogSeenStorage) {}
  private load(): Record<string, Record<string, string>> {
    try {
      const raw = this.storage.read()
      return raw ? seenSchema.parse(JSON.parse(raw)).callers : {}
    } catch { return {} }
  }
  /** activeCallers 用来顺手清掉已撤销连接的记录。 */
  record(callerId: string, hashes: Record<string, string>, activeCallers: readonly string[]): void {
    const callers = Object.fromEntries(Object.entries(this.load()).filter(([id]) => activeCallers.includes(id)))
    callers[callerId] = hashes
    // 记不下只是少一道保护，不能让列工具清单失败
    try { this.storage.write(JSON.stringify({ callers })) } catch { /* 下次列举再记 */ }
  }
  /** 只有记录过且与当前不同才算过期；从没记录过的工具与连接不拦。 */
  stale(callerId: string, tool: string, current: string): boolean {
    const seen = this.load()[callerId]?.[tool]
    return seen !== undefined && seen !== current
  }
  staleAny(callerId: string, current: Record<string, string>): boolean {
    const seen = this.load()[callerId]
    return seen !== undefined && Object.entries(current).some(([tool, hash]) => seen[tool] !== undefined && seen[tool] !== hash)
  }
}
