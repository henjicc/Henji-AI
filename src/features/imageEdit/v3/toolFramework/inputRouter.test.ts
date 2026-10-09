import { describe, expect, it } from 'vitest'
import type { InteractionKeyboardInput } from '@/core/imaging/interaction/contracts'
import { tools } from '../toolEntries/legacy'
import { ToolRegistry } from './registry'
import { ToolInputRouter } from './inputRouter'

const key = (code: string, patch: Partial<InteractionKeyboardInput> = {}): InteractionKeyboardInput => ({
  code, repeat: false, composing: false, editable: false, modal: false, ctrl: false, meta: false, alt: false, ...patch,
})

describe('输入路由', () => {
  it('文字/IME/模态/修饰键及连发不触发工具或临时导航', () => {
    const router = new ToolInputRouter(new ToolRegistry(tools), 'move')
    for (const flag of ['composing', 'editable', 'modal', 'ctrl', 'meta', 'alt', 'repeat'] as const) {
      expect(router.keyDown(key('Space', { [flag]: true }), () => true)).toBeNull()
      expect(router.keyDown(key('KeyB', { [flag]: true }), () => true)).toBeNull()
    }
    expect(router.effectiveTool).toBe('move')
  })
  it('临时键可以嵌套，按释放顺序恢复且保留期间新选中的工具', () => {
    const router = new ToolInputRouter(new ToolRegistry(tools), 'raster-brush')
    expect(router.keyDown(key('Space'), () => true)).toBe('hand')
    expect(router.keyDown(key('KeyZ'), () => true)).toBe('zoom')
    router.select('eraser')
    expect(router.keyUp('Space')).toBe(true)
    expect(router.effectiveTool).toBe('zoom')
    expect(router.keyUp('KeyZ')).toBe(true)
    expect(router.effectiveTool).toBe('eraser')
    expect(router.keyUp('KeyZ')).toBe(false)
  })
  it('宿主不可用的工具不能从快捷键绕过；失焦清除全部临时键', () => {
    const router = new ToolInputRouter(new ToolRegistry(tools), 'crop')
    expect(router.keyDown(key('KeyB'), () => false)).toBeNull()
    router.keyDown(key('Space'), () => true)
    router.reset('blur')
    expect(router.effectiveTool).toBe('crop')
    expect(router.temporaryActive).toBe(false)
  })
})
