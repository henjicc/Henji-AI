import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readMcpPreferences, writeMcpPreferences } from './preferences'
const database = vi.hoisted(() => new Map<string, string>())
vi.mock('../db', () => ({ getDb: () => ({ prepare: () => ({
  get: (key: string) => database.has(key) ? { value: database.get(key) } : undefined,
  run: (key: string, value: string) => database.set(key, value),
}) }) }))
beforeEach(() => database.clear())
describe('MCP 设置持久化', () => {
  it('首次全部启用；显式关闭、端口在重新读取时保留', () => {
    expect(readMcpPreferences()).toEqual({ enabled: true, port: 43821 })
    const saved = { enabled: false, port: 43822 }
    writeMcpPreferences(saved)
    expect(readMcpPreferences()).toEqual(saved)
  })
  it('损坏的设置记录不能被默认值掩盖', () => {
    database.set('mcp.preferences', '{"enabled":false}')
    expect(() => readMcpPreferences()).toThrow()
  })
})
