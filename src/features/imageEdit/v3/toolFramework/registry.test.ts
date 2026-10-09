import { describe, expect, it } from 'vitest'
import { tools } from '../toolEntries/legacy'
import { ToolRegistry } from './registry'

describe('工具登记', () => {
  it('所有当前工具声明入口、宿主、图标、光标和意图，并保留宿主工具顺序', () => {
    const registry = new ToolRegistry(tools)
    expect(registry.list()).toHaveLength(24)
    expect(registry.list().filter(tool => tool.profiles.includes('mask')).map(tool => tool.id)).toEqual([
      'move', 'hand', 'zoom', 'select-rect', 'select-ellipse', 'select-lasso', 'raster-brush', 'eraser', 'mask-edit',
    ])
    expect(registry.overlays().map(slot => slot.id)).toEqual(['annotation', 'crop', 'selection', 'raster'])
  })
  it('冲突登记整体拒绝，不以覆盖顺序悄悄选用一个实现', () => {
    expect(() => new ToolRegistry([tools[0], tools[0]])).toThrow('Duplicate tool id')
    expect(() => new ToolRegistry([tools[0], { ...tools[1], shortcut: tools[0].shortcut }])).toThrow('Conflicting tool shortcut')
    expect(() => new ToolRegistry([{ ...tools[0], shortcut: 'Space' }])).toThrow('Conflicting tool shortcut')
    expect(() => new ToolRegistry([tools[0], { ...tools[1], overlays: [{ id: 'annotation', render: () => null }] }])).toThrow('Conflicting overlay slot')
  })
})
