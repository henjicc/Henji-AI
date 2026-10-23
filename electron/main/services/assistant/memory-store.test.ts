import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))

import { createAssistantMemoryTablesV1, replaceAssistantMemoryTablesV22, assistantMemoryNeedsBackup } from './storageSchema'
import { MemoryEntryStore } from './entry-store'

const describeWithElectronSqlite = process.versions.electron ? describe : describe.skip

describeWithElectronSqlite('三层记忆存储底座', () => {
  it('一次性迁移丢弃旧数据，设置、历史与逐条修改持久保存；关闭后不读不写', () => {
    const db = new Database(':memory:')
    try {
      createAssistantMemoryTablesV1(db)
      db.exec("INSERT INTO agent_memories(memory_id,scope_type,kind,content,source_label,sensitivity,status,created_at,updated_at) VALUES('legacy','global','preference','旧记忆','用户','C1','active',0,0)")
      expect(assistantMemoryNeedsBackup(db)).toBe(true)
      db.transaction(() => replaceAssistantMemoryTablesV22(db))()
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'agent_memor%'").all()).toEqual([])
      const store = new MemoryEntryStore(db)
      expect(store.read().entries).toEqual([])
      const changed = vi.fn(() => expect(db.inTransaction).toBe(false))
      store.onMemoryChange(changed)
      const request = { target: { layer: 'global' as const }, id: 'font', expectedRevision: 0, actor: 'assistant' as const, reason: '用户指定字体。', entry: { section: 'creative' as const, content: '中文默认思源黑体。', source: 'assistant' as const } }
      const first = store.write(request)
      expect(changed).toHaveBeenCalledOnce()
      expect(() => store.write(request)).toThrow('CONFLICT')
      expect(new MemoryEntryStore(db).read()).toEqual(first)
      store.requestOrganization()
      store.markOrganized(0, true)
      expect(store.read()).toMatchObject({ needsOrganization: true, changesSinceOrganization: 1 })
      expect(store.read().lastOrganizedAt).not.toBeNull()
      store.markOrganized(1)
      expect(store.read()).toMatchObject({ needsOrganization: false, changesSinceOrganization: 0 })
      const undone = store.revert(first.history[0].id, 'user')
      expect(undone.entries).toEqual([])
      expect(undone.history).toHaveLength(2)
      expect(undone.history[1].reverts).toBe(first.history[0].id)
      store.updateSettings({ enabled: false, autoOrganize: true })
      expect(store.read().history).toEqual([])
      expect(() => store.write(request)).toThrow('MEMORY_DISABLED')
      store.updateSettings({ enabled: true, autoOrganize: true })
      expect(store.read().history).toHaveLength(2)
    } finally { db.close() }
  })
})
