import { describe, expect, it } from 'vitest'
import { tools as legacyTools } from '../toolEntries/legacy'
import { tools as paintTools } from '../toolEntries/paint'
import {tools as vectorTools} from '../toolEntries/vector'
const tools = [...legacyTools, ...paintTools,...vectorTools]
import { ToolRegistry } from './registry'

describe('工具登记', () => {
  it('当前全部工具可无冲突登记并保留登记顺序，共享叠加层只出现一次', () => {
    const registry = new ToolRegistry(tools)
    expect(registry.list().map(tool => tool.id)).toEqual(tools.map(tool => tool.id))
    const overlayIds = registry.overlays().map(slot => slot.id)
    expect(new Set(overlayIds).size).toBe(overlayIds.length)
  })
  it('冲突登记整体拒绝，不以覆盖顺序悄悄选用一个实现', () => {
    expect(() => new ToolRegistry([tools[0], tools[0]])).toThrow('Duplicate tool id')
    expect(() => new ToolRegistry([tools[0], { ...tools[1], shortcut: tools[0].shortcut }])).toThrow('Conflicting tool shortcut')
    expect(() => new ToolRegistry([{ ...tools[0], shortcut: 'Space' }])).toThrow('Conflicting tool shortcut')
    expect(() => new ToolRegistry([tools.find(tool => tool.id === 'select-rect')!, { ...tools[1], overlays: [{ id: 'selection', render: () => null }] }])).toThrow('Conflicting overlay slot')
  })
})
