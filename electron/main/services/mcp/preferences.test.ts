import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readMcpPreferences, writeMcpPreferences } from './preferences'
const database = vi.hoisted(() => new Map<string, string>())
vi.mock('../db', () => ({ getDb: () => ({ prepare: () => ({
  get: (key: string) => database.has(key) ? { value: database.get(key) } : undefined,
  run: (key: string, value: string) => database.set(key, value),
}) }) }))
beforeEach(() => database.clear())
describe('MCP 设置持久化', () => {
  it('首次全部启用；显式关闭、端口和权限在重新读取时保留', () => {
    expect(readMcpPreferences()).toEqual({ enabled: true, port: 43821, defaultAccess: { allowWrites: true, allowPaid: true, allowDestructive: true } })
    const saved = { enabled: false, port: 43822, defaultAccess: { allowWrites: true, allowPaid: false, allowDestructive: false } }
    writeMcpPreferences(saved)
    expect(readMcpPreferences()).toEqual(saved)
  })
  it('损坏的权限记录不能默默恢复为全权限', () => {
    database.set('mcp.preferences', '{"enabled":false}')
    expect(() => readMcpPreferences()).toThrow()
  })
})
