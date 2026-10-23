import { randomUUID, createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { memorySnapshotSchema, memorySettingsSchema, memoryHistoryEntrySchema, MEMORY_HISTORY_LIMIT, type MemorySnapshot, type MemorySettings, type MemoryHistoryEntry } from '../../../../src/core/assistant/memoryEntries'
import { applyMemoryWrite, memoryRevertWrite, type MemoryWrite } from '../../../../src/core/assistant/memoryOperations'
import { createMainLogger } from '../logging'

const logger = createMainLogger('main.assistant.memory')
export interface MemoryChange { domain: 'memory'; revisions: Record<string, number>; change?: MemoryHistoryEntry }

/** 全局记忆与三层修改历史的唯一 SQLite 入口；项目、风格正文仍归各自文件。 */
export class MemoryEntryStore {
  private readonly listeners = new Set<(change: MemoryChange) => void>()
  constructor(private readonly database: Database.Database) {}

  onMemoryChange(listener: (change: MemoryChange) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }

  getState(): MemorySnapshot {
    const row = this.database.prepare('SELECT state_json FROM assistant_memory WHERE id = 1').get() as { state_json: string } | undefined
    if (!row) throw new Error('MEMORY_NOT_READY：记忆存储尚未初始化。')
    return memorySnapshotSchema.parse(JSON.parse(row.state_json))
  }

  read(): MemorySnapshot {
    const state = this.getState()
    return state.settings.enabled ? state : { ...state, entries: [], history: [] }
  }

  private save(state: MemorySnapshot): void {
    this.database.prepare('UPDATE assistant_memory SET state_json = ? WHERE id = 1').run(JSON.stringify(memorySnapshotSchema.parse(state)))
  }

  private publish(state: MemorySnapshot, change?: MemoryHistoryEntry): void {
    const revisions: Record<string, number> = { assistant_memory: state.revision, memory_settings: state.revision }
    if (change) {
      const kind = { global: 'assistant.memory', project: 'document.project_memory', style: 'video_edit.style_preference' }[change.target.layer]
      const id = change.target.layer === 'global' ? change.entryId : `${change.target.ownerId}:${change.entryId}`
      revisions[`memory.${createHash('sha256').update(`${kind}:${id}`).digest('hex')}`] = change.after?.revision ?? 0
    }
    const event: MemoryChange = { domain: 'memory', revisions, change }
    for (const listener of this.listeners) {
      try { listener(event) } catch (error) { logger.error('记忆变更通知失败', { event: 'memory.notification.failed', error }) }
    }
  }

  recordExternal(input: MemoryHistoryEntry): MemorySnapshot {
    const change = memoryHistoryEntrySchema.parse(input)
    const next = this.database.transaction(() => {
      const state = this.getState()
      if (!state.settings.enabled) throw new Error('MEMORY_DISABLED：记忆已关闭。')
      if (state.history.some(item => item.id === change.id)) return { state, changed: false }
      const next = { ...state, history: [...state.history, change].slice(-MEMORY_HISTORY_LIMIT), revision: state.revision + 1, changesSinceOrganization: state.changesSinceOrganization + 1 }
      this.save(next); return { state: next, changed: true }
    })()
    if (next.changed) this.publish(next.state, change)
    return next.state
  }

  requestOrganization(): void {
    const state = this.getState()
    if (!state.settings.enabled || state.needsOrganization) return
    const next = { ...state, needsOrganization: true, revision: state.revision + 1 }
    this.save(next); this.publish(next)
  }

  markOrganized(startedChanges: number, attemptOnly = false): void {
    const next = this.database.transaction(() => {
      const state = this.getState()
      if (!state.settings.enabled) throw new Error('MEMORY_DISABLED：记忆已关闭。')
      const next = { ...state, needsOrganization: attemptOnly ? state.needsOrganization : false, lastOrganizedAt: new Date().toISOString(), changesSinceOrganization: attemptOnly ? state.changesSinceOrganization : Math.max(0, state.changesSinceOrganization - startedChanges), revision: state.revision + 1 }
      this.save(next); return next
    })()
    this.publish(next)
  }

  updateSettings(input: MemorySettings): MemorySnapshot {
    const settings = memorySettingsSchema.parse(input)
    const next = this.database.transaction(() => {
      const current = this.getState()
      const state = { ...current, settings, revision: current.revision + 1 }
      this.save(state); return state
    })()
    this.publish(next)
    return this.read()
  }

  write(input: MemoryWrite, reverts?: string): MemorySnapshot {
    logger.info('开始修改记忆', { event: 'memory.write.start', context: { layer: input.target.layer, entryId: input.id } })
    try {
      const result = this.database.transaction(() => {
        const state = this.getState()
        if (!state.settings.enabled) throw new Error('MEMORY_DISABLED：记忆已关闭，请先在设置中开启。')
        if (input.target.layer !== 'global') throw new Error('INVALID_TARGET：项目与风格记忆必须在所属文件中修改。')
        const result = applyMemoryWrite(state.entries, input, new Date(), randomUUID())
        if (!result.change) return { state, change: undefined }
        const change = { ...result.change, ...(reverts ? { reverts } : {}) }
        const next = { ...state, entries: result.entries, history: [...state.history, change].slice(-MEMORY_HISTORY_LIMIT), revision: state.revision + 1, changesSinceOrganization: state.changesSinceOrganization + 1 }
        this.save(next); return { state: next, change }
      })()
      if (result.change) this.publish(result.state, result.change)
      logger.info('记忆已修改', { event: 'memory.write.completed', context: { entryId: input.id } })
      return result.state
    } catch (error) { if (error instanceof Error && error.message.startsWith('MEMORY_CAPACITY')) this.requestOrganization(); logger.error('修改记忆失败', { event: 'memory.write.failed', error }); throw error }
  }

  revert(id: string, actor: 'user' | 'assistant'): MemorySnapshot {
    const state = this.getState()
    const change = state.history.find(item => item.id === id)
    if (!change) throw new Error('NOT_FOUND：这次修改已不在最近的记忆历史中。')
    return this.write(memoryRevertWrite(change, state.entries, actor), id)
  }
}
