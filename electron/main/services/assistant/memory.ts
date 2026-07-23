import type {
  AgentMemoryRecord,
  AgentMemoryScope,
  AgentMemorySettings,
  AgentMemorySettingsUpdate,
  AgentMemoryUpdate,
} from '../../../../src/core/assistant/memory'
import { getDb } from '../db'
import { AgentMemoryStore } from './memory-store'

let memoryStore: AgentMemoryStore | null = null

export function getAgentMemoryStore(): AgentMemoryStore {
  memoryStore ??= new AgentMemoryStore(getDb())
  return memoryStore
}

export function clearAgentMemories(scope?: AgentMemoryScope): number {
  return getAgentMemoryStore().clear(scope)
}

export function updateAgentMemorySettings(update: AgentMemorySettingsUpdate): AgentMemorySettings {
  return getAgentMemoryStore().updateSettings(update)
}

export function updateAgentMemory(update: AgentMemoryUpdate): AgentMemoryRecord {
  return getAgentMemoryStore().update(update)
}
