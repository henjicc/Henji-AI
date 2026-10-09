import { acceptsToolKeyboard, type InteractionCancelReason, type InteractionKeyboardInput } from '@/core/imaging/interaction/contracts'
import { InteractionLifecycle } from '@/core/imaging/interaction/lifecycle'
import type { ToolRegistry } from './registry'
import type { ToolDefinition } from './types'

/** Keyboard policy and exclusive gesture lease; no DOM listeners or domain writes here. */
export class ToolInputRouter {
  readonly lifecycle = new InteractionLifecycle()
  private readonly temporary = new Map<string, 'hand' | 'zoom'>()

  constructor(private readonly registry: ToolRegistry, private selected: ToolDefinition['id']) {}

  get effectiveTool(): ToolDefinition['id'] { return [...this.temporary.values()].at(-1) ?? this.selected }
  get temporaryActive(): boolean { return this.temporary.size > 0 }

  select(id: ToolDefinition['id']): void {
    if (id !== this.selected) this.cancel('tool-change')
    this.selected = id
  }

  keyDown(input: InteractionKeyboardInput, available: (definition: ToolDefinition) => boolean): ToolDefinition['id'] | null {
    if (!acceptsToolKeyboard(input)) return null
    const temporary = input.code === 'Space' ? 'hand' : input.code === 'KeyZ' ? 'zoom' : null
    if (temporary) {
      const definition = this.registry.get(temporary)
      if (!definition || !available(definition)) return null
      this.cancel('temporary-tool')
      this.temporary.set(input.code, temporary)
      return this.effectiveTool
    }
    const definition = this.registry.shortcut(input.code)
    if (!definition || !available(definition)) return null
    this.select(definition.id)
    return definition.id
  }

  keyUp(code: string): boolean {
    if (!this.temporary.has(code)) return false
    this.cancel('temporary-tool')
    this.temporary.delete(code)
    return true
  }

  cancel(reason: InteractionCancelReason): boolean { return this.lifecycle.cancel(reason) }
  reset(reason: InteractionCancelReason): void { this.cancel(reason); this.temporary.clear() }
}
