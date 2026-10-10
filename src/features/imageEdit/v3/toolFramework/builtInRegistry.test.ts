import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hand } from 'lucide-react'
import type { ToolDefinition } from './types'

const state = vi.hoisted(() => ({ tools: [] as ToolDefinition[], manifests: [] as ToolDefinition[], failed: false, error: vi.fn() }))
vi.mock('../toolEntries/vector',()=>({tools:[]}))
vi.mock('../toolEntries/transform', () => ({ tools: [] }))
vi.mock('../toolEntries/paint', () => ({ tools: [] }))
vi.mock('../toolEntries/retouch', () => ({ tools: [] }))
vi.mock('../toolEntries/legacy', () => ({ get tools() { return state.tools } }))
vi.mock('./toolManifest', async () => {
  const { ToolRegistry } = await import('./registry')
  return { toolManifestRegistration: { get registry() { return new ToolRegistry(state.manifests) }, get failed() { return state.failed } } }
})
vi.mock('@/core/logging', () => ({ createLogger: () => ({ error: state.error }) }))

beforeEach(() => {
  vi.resetModules()
  state.error.mockClear()
  state.failed = false
  state.tools = [{ id: 'hand', labelKey: 'hand', description: '平移画面', aliases: ['hand'], icon: Hand,
    group: { id: 'navigation', order: 0 }, profiles: ['full'], cursor: 'cursor-grab', input: 'navigation' }]
  state.manifests = state.tools
})

describe('内置工具登记失败边界', () => {
  it('有效清单与实现匹配时开放工具', async () => {
    const { builtInToolRegistration } = await import('./builtInRegistry')
    expect(builtInToolRegistration.failed).toBe(false)
    expect(builtInToolRegistration.registry.get('hand')).toBeDefined()
  })
  it.each(['manifest', 'implementation'] as const)('%s 登记失败时留下错误入口并拒绝全部编辑输入', async source => {
    if (source === 'manifest') state.failed = true
    else state.manifests = []
    const { builtInToolRegistration } = await import('./builtInRegistry')
    expect(builtInToolRegistration.failed).toBe(true)
    expect(builtInToolRegistration.registry.list()).toEqual([])
    expect(state.error).toHaveBeenCalledOnce()
    expect(state.error).toHaveBeenCalledWith('图片编辑工具登记失败', expect.any(Error), {
      event: 'image_editor.tools.registration.failed',
    })
  })
})
