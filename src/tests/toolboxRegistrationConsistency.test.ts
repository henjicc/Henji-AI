// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { TOOL_CATALOG, TOOL_DESCRIPTORS, createToolCatalog, type ToolDescriptor } from '@/core/toolbox/toolCatalog'
import { toolboxToolIdSchema } from '@/core/types/workspace'
import { APPLICATION_SURFACE_IDS } from '@/core/application-control/applicationSurfaces'
import { listApplicationSurfaces, createToolboxSurfaces } from '@/features/navigation/application/surfaceCatalog'
import { getToolboxRecentFileProviders, mergeToolboxRecentFiles } from '@/features/toolbox/toolboxRecentFiles'
import { TOOLBOX_APPLICATION_CAPABILITIES } from '@/core/application-control/domains/toolbox/toolboxApplicationCapabilities'
import { createToolboxRuntime, TOOLBOX_RUNTIME } from '@/workspaces/toolboxRuntime'

const sorted = (values: Iterable<string>): string[] => [...values].sort()
const document = { id: 'document-probe', name: '登记探测', updatedAt: 1 }

afterEach(cleanup)

describe('工具箱登记 → 派生入口', () => {
  it('工具类型/schema、加载器、Surface、最近文件和能力输入输出都派生自登记', () => {
    const ids = sorted(TOOL_CATALOG.tools.map((tool) => tool.id))
    expect(sorted(toolboxToolIdSchema.options)).toEqual(ids)
    expect(sorted(TOOLBOX_RUNTIME.map((tool) => tool.descriptor.id))).toEqual(ids)
    expect(sorted(listApplicationSurfaces().flatMap((surface) => surface.toolId ? [surface.toolId] : []))).toEqual(ids)
    expect(sorted(APPLICATION_SURFACE_IDS.filter((id) => id.startsWith('tool.'))))
      .toEqual(sorted(TOOL_CATALOG.tools.map((tool) => tool.surfaceId)))
    const providers = getToolboxRecentFileProviders(TOOLBOX_RUNTIME)
    expect(sorted(providers.map((tool) => tool.descriptor.id)))
      .toEqual(sorted(TOOL_CATALOG.tools.filter((tool) => tool.actions.includes('recent_files')).map((tool) => tool.id)))
    const recent = mergeToolboxRecentFiles(providers.map((tool) => ({ toolId: tool.descriptor.id, documents: [document] })))
    expect(sorted(recent.map((file) => file.toolId))).toEqual(ids)
    const select = TOOLBOX_APPLICATION_CAPABILITIES.find((entry) => entry.id === 'select_toolbox_tool')!
    const input = z.toJSONSchema(select.inputSchema) as unknown as { properties: { toolId: { anyOf: { enum?: string[] }[] } } }
    const output = z.toJSONSchema(select.outputSchema) as unknown as { properties: { toolId: { anyOf: { enum?: string[] }[] }; surfaceId: { anyOf: { enum?: string[] }[] } } }
    expect(sorted(input.properties.toolId.anyOf.flatMap((item) => item.enum ?? []))).toEqual(ids)
    expect(sorted(output.properties.toolId.anyOf.flatMap((item) => item.enum ?? []))).toEqual(ids)
    expect(sorted(output.properties.surfaceId.anyOf.flatMap((item) => item.enum ?? [])))
      .toEqual(sorted(TOOL_CATALOG.tools.map((tool) => tool.surfaceId)))
    expect(select.inputSchema.safeParse({ toolId: 'unregistered' }).success).toBe(false)
  })

  it('临时登记探针，真实加载组件并打开最近文件；移除后所有派生入口消失', async () => {
    const probe = {
      id: 'registrationProbe', surfaceId: 'tool.registration_probe', entryId: 'registrationProbe',
      titleKey: 'ui:probe.title', descriptionKey: 'ui:probe.description', icon: 'ICON_TOOL_IMAGE_EDIT',
      actions: ['open', 'recent_files'], recentFiles: { documentKind: 'image_document' },
      acceptedRefKinds: ['probe.document'], capabilities: [],
    } as const satisfies ToolDescriptor
    // 隔离装配目录就是一次临时注册，不修改生产全局或持久数据。
    const catalog = createToolCatalog([...TOOL_DESCRIPTORS, probe])
    const load = vi.fn(async () => ({ default: () => createElement('span', null, '探针工作面') }))
    const open = vi.fn(async (_id: string): Promise<void> => {})
    const runtime = createToolboxRuntime([probe], {
      './toolboxTools/registrationProbe/entry.ts': { default: { loadComponent: load, openRecentFile: open } },
    })
    expect(load).not.toHaveBeenCalled()
    render(createElement(runtime[0].component, { onBack: vi.fn() }))
    expect(await screen.findByText('探针工作面')).toBeTruthy()
    expect(load).toHaveBeenCalledOnce()
    expect(createToolboxSurfaces(catalog.tools).find((surface) => surface.toolId === probe.id))
      .toMatchObject({ id: probe.surfaceId, acceptedRefKinds: ['probe.document'] })
    expect(catalog.selectionInputSchema.parse({ toolId: probe.id })).toEqual({ toolId: probe.id })
    expect(z.object(catalog.selectionOutputShape).safeParse({ toolId: probe.id, surfaceId: probe.surfaceId }).success).toBe(true)
    const providers = getToolboxRecentFileProviders(runtime)
    const recent = mergeToolboxRecentFiles(providers.map((tool) => ({ toolId: tool.descriptor.id, documents: [document] })))
    await providers[0].openRecentFile!(recent[0].projectId)
    expect(open).toHaveBeenCalledWith(document.id)
    cleanup()
    // 卸除临时 descriptor 和目录模块，重新装配同一生产源。
    const removed = createToolCatalog(catalog.tools.filter((tool) => tool.id !== probe.id))
    expect(removed.get(probe.id)).toBeUndefined()
    expect(removed.selectionInputSchema.safeParse({ toolId: probe.id }).success).toBe(false)
    expect(removed.surfaceIdSchema.safeParse(probe.surfaceId).success).toBe(false)
    expect(createToolboxSurfaces(removed.tools).map((surface) => surface.id)).not.toContain(probe.surfaceId)
    const remaining = createToolboxRuntime(removed.tools)
    expect(remaining.map((tool) => tool.descriptor.id)).not.toContain(probe.id)
    expect(getToolboxRecentFileProviders(remaining).map((tool) => tool.descriptor.id)).not.toContain(probe.id)
    expect(TOOL_CATALOG.get(probe.id)).toBeUndefined()
  })

  it('缺失加载器或最近文件打开器、重复登记当场拒绝', () => {
    expect(() => createToolboxRuntime(TOOL_DESCRIPTORS, {})).toThrow('缺少渲染入口')
    expect(() => createToolboxRuntime([TOOL_DESCRIPTORS[0]], {
      './toolboxTools/audioEdit/entry.ts': { default: { loadComponent: async () => ({ default: () => null }) } },
    })).toThrow('缺少最近文件打开器')
    expect(() => createToolCatalog([...TOOL_DESCRIPTORS, TOOL_DESCRIPTORS[0]])).toThrow('重复')
  })
})
