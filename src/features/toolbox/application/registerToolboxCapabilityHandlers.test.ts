// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TOOL_CATALOG } from '@/core/toolbox/toolCatalog'
import { useNavigationStore } from '@/stores/navigationStore'
import type { CapabilityHandler } from '@/features/application-control/capabilities/handlerTypes'
import { registerToolboxCapabilityHandlers } from './registerToolboxCapabilityHandlers'

// 非本次工具导航目标的画布服务不参与执行，隔离其导入装配副作用。
vi.mock('@/features/canvas/application/canvasApplicationService', () => ({ focusCanvasNode: vi.fn(), openCanvasProject: vi.fn() }))
vi.mock('@/features/assets/application/assetApplicationService', () => ({ assetApplicationService: { select: vi.fn() } }))

const handlers = new Map<string, CapabilityHandler>()
registerToolboxCapabilityHandlers({ registerHandler: (id, handler) => { handlers.set(id, handler) } })
const context = { signal: new AbortController().signal }

beforeEach(() => useNavigationStore.setState({ activeWorkspace: 'generation', activeToolId: null }))

describe('工具选择处理器复用登记与正式导航服务', () => {
  it.each(TOOL_CATALOG.tools)('$id 打开实际登记 Surface 并回读选择', async (tool) => {
    const result = await handlers.get('select_toolbox_tool')!({ toolId: tool.id }, context)
    expect(result).toMatchObject({ toolId: tool.id, surfaceId: tool.surfaceId, verification: { verified: true } })
    expect(useNavigationStore.getState()).toMatchObject({ activeWorkspace: 'tools', activeToolId: tool.id })
  })

  it('关闭工具保留用户当前工作区，未知工具在导航前拒绝', async () => {
    useNavigationStore.setState({ activeToolId: 'imageMark' })
    expect(await handlers.get('select_toolbox_tool')!({ toolId: null }, context))
      .toEqual({ toolId: null, surfaceId: null })
    expect(useNavigationStore.getState()).toMatchObject({ activeWorkspace: 'generation', activeToolId: null })
    expect(() => handlers.get('select_toolbox_tool')!({ toolId: 'unregistered' }, context)).toThrow()
    expect(useNavigationStore.getState().activeWorkspace).toBe('generation')
  })

  it('助手工具目录包含全部可打开工具，同时保留原图片控制目录', async () => {
    const result = await handlers.get('list_toolbox_tools')!({}, context)
    const tools = result.tools as { id: string; name: string; surfaceId?: string }[]
    for (const tool of TOOL_CATALOG.tools) {
      expect(tools.find((entry) => entry.id === tool.id)).toMatchObject({ surfaceId: tool.surfaceId })
      expect(tools.find((entry) => entry.id === tool.id)?.name).not.toBe(tool.titleKey)
    }
    expect(tools.some((entry) => entry.id === 'geometry')).toBe(true)
  })
})
