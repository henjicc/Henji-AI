import type { ToolDefinition } from './types'

export class ToolRegistry {
  private readonly definitions = new Map<string, ToolDefinition>()
  private readonly shortcuts = new Map<string, ToolDefinition>()

  constructor(entries: readonly ToolDefinition[]) {
    const slots = new Map<string, unknown>()
    for (const entry of entries) {
      if (!entry.id || this.definitions.has(entry.id)) throw new Error(`Duplicate tool id: ${entry.id}`)
      const shortcut = entry.shortcut?.toLowerCase()
      if (shortcut && (this.shortcuts.has(shortcut) || ['space', 'keyz', 'escape'].includes(shortcut))) {
        throw new Error(`Conflicting tool shortcut: ${entry.shortcut}`)
      }
      if (!entry.description || !entry.profiles.length) throw new Error(`Incomplete tool definition: ${entry.id}`)
      for (const slot of entry.overlays ?? []) {
        if (slots.has(slot.id) && slots.get(slot.id) !== slot) throw new Error(`Conflicting overlay slot: ${slot.id}`)
        slots.set(slot.id, slot)
      }
      this.definitions.set(entry.id, entry)
      if (shortcut) this.shortcuts.set(shortcut, entry)
    }
  }

  get(id: string): ToolDefinition | undefined { return this.definitions.get(id) }
  list(): readonly ToolDefinition[] { return [...this.definitions.values()] }
  shortcut(code: string): ToolDefinition | undefined { return this.shortcuts.get(code.toLowerCase()) }
  overlays(): readonly NonNullable<ToolDefinition['overlays']>[number][] {
    return [...new Map(this.list().flatMap(entry => entry.overlays ?? []).map(slot => [slot.id, slot])).values()]
  }
}
