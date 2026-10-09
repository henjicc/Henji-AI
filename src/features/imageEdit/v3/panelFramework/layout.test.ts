// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDockview, type DockviewApi } from 'dockview-react'

import {
  createImageEditorMemoryLayoutStoreV3,
  imageEditorWorkspaceLayoutStoreV3,
  resetImageEditorDockLayoutV3,
  showImageEditorPanelV3,
  validateImageEditorDockLayoutV3,
} from './layout'
import type { ImageEditorPanelDefinitionV3 } from './panelRegistry'

const definitions: readonly ImageEditorPanelDefinitionV3[] = ['layers', 'properties'].map((id, order) => ({
  id, order, title: id, titleKey: id, component: () => null,
}))
let api: DockviewApi
let host: HTMLDivElement
let created: Record<string, number>

beforeEach(() => {
  created = {}
  vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1440, 860))
  host = document.createElement('div')
  document.body.append(host)
  api = createDockview(host, { disableAutoResizing: true, floatingGroupBounds: 'boundedWithinViewport', createComponent: ({ id }) => {
    created[id] = (created[id] ?? 0) + 1
    return { element: document.createElement('div'), init(): void {}, dispose(): void {} }
  } })
  api.layout(1440, 860)
  resetImageEditorDockLayoutV3(api, definitions, definition => definition.title)
})
afterEach(() => { api.dispose(); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('图片停靠布局（真实 Dockview API）', () => {
  it('历史同组标签不替换默认图层，显式打开才激活且关闭后可重开', () => {
    const history: ImageEditorPanelDefinitionV3 = { id: 'history', order: 2, title: '历史', titleKey: 'history', component: () => null, defaultPlacement: 'tab' }
    resetImageEditorDockLayoutV3(api, [...definitions, history], definition => definition.title)
    expect(api.getPanel('history')!.group).toBe(api.getPanel('layers')!.group)
    expect(api.getPanel('layers')!.group.activePanel?.id).toBe('layers')
    showImageEditorPanelV3(api, history, history.title)
    expect(api.getPanel('history')!.group.activePanel?.id).toBe('history')
    api.getPanel('history')!.api.close()
    showImageEditorPanelV3(api, history, history.title)
    expect(api.panels.filter(panel => panel.id === 'history')).toHaveLength(1)
  })
  it('关闭重开保留同工作区布局，其他工作区独立且读取快照不可变', () => {
    const toolbox = imageEditorWorkspaceLayoutStoreV3('layout-test-toolbox')
    toolbox.save('full', { dock: api.toJSON(), collapsed: ['layers'] })
    const reopened = imageEditorWorkspaceLayoutStoreV3('layout-test-toolbox')
    const saved = reopened.load('full') as { collapsed: string[] }
    expect(saved.collapsed).toEqual(['layers'])
    saved.collapsed.length = 0
    expect(reopened.load('full')).toMatchObject({ collapsed: ['layers'] })
    expect(imageEditorWorkspaceLayoutStoreV3('layout-test-canvas').load('full')).toBeUndefined()
  })

  it('默认右侧两组、隐藏重开、标签重排、浮动贴回与重置保留唯一预览', () => {
    const preview = api.getPanel('preview')!
    expect(preview.group.locked).toBe(true)
    expect(api.groups).toHaveLength(3)
    const layers = api.getPanel('layers')!
    const properties = api.getPanel('properties')!
    properties.api.moveTo({ group: layers.group, position: 'center' })
    expect(layers.group.panels.map(({ id }) => id)).toEqual(['layers', 'properties'])
    api.addFloatingGroup(properties, { width: 400, height: 480 })
    expect(properties.api.location.type).toBe('floating')
    properties.api.moveTo({ group: layers.group, position: 'center' })
    expect(properties.api.location.type).toBe('grid')
    layers.api.close()
    expect(api.getPanel('layers')).toBeUndefined()
    showImageEditorPanelV3(api, definitions[0], '图层')
    expect(api.getPanel('layers')).toBeTruthy()
    resetImageEditorDockLayoutV3(api, definitions, definition => definition.title)
    expect(api.getPanel('preview')).toBe(preview)
    expect(created.preview).toBe(1)
    expect(api.groups).toHaveLength(3)
  })

  it('布局存取独立于文档，按 profile 隔离，关闭状态不被自动重开', () => {
    api.getPanel('properties')!.api.close()
    const store = createImageEditorMemoryLayoutStoreV3()
    const layout = { dock: api.toJSON(), collapsed: ['layers'] }
    store.save('full', layout)
    layout.collapsed.push('properties')
    const read = store.load('full')
    validateImageEditorDockLayoutV3(read, definitions)
    expect(read.collapsed).toEqual(['layers'])
    expect(store.load('quick')).toBeUndefined()
    api.fromJSON(read.dock)
    expect(api.getPanel('properties')).toBeUndefined()
    expect(api.getPanel('layers')).toBeTruthy()
  })

  it('浮动布局由正式序列化器往返，不把浮动面板丢掉', () => {
    api.addFloatingGroup(api.getPanel('properties')!, { width: 400, height: 480 })
    const layout = { dock: api.toJSON(), collapsed: [] }
    expect(() => validateImageEditorDockLayoutV3(layout, definitions)).not.toThrow()
    api.fromJSON(layout.dock)
    expect(api.getPanel('properties')!.api.location.type).toBe('floating')
  })

  it('恢复拒绝损坏数据、未知组件、profile 越界、重复引用和外部浮窗', () => {
    const valid = { dock: api.toJSON(), collapsed: [] }
    expect(() => validateImageEditorDockLayoutV3(valid, definitions)).not.toThrow()
    expect(() => validateImageEditorDockLayoutV3({}, definitions)).toThrow()
    expect(() => validateImageEditorDockLayoutV3(valid, [definitions[0]])).toThrow('当前宿主')
    const invalid = structuredClone(valid)
    invalid.dock.panels.layers.contentComponent = 'other-component'
    expect(() => validateImageEditorDockLayoutV3(invalid, definitions)).toThrow('当前宿主')
    const missing = structuredClone(valid)
    delete missing.dock.panels.preview
    expect(() => validateImageEditorDockLayoutV3(missing, definitions)).toThrow('图片预览')
    expect(() => validateImageEditorDockLayoutV3({ ...valid, collapsed: ['layers', 'layers'] }, definitions)).toThrow('折叠')
    expect(() => validateImageEditorDockLayoutV3({ ...valid, dock: { ...valid.dock, popoutGroups: [] } }, definitions)).toThrow('停靠位置')
    const previewInTab = structuredClone(valid)
    const first = Array.isArray(previewInTab.dock.grid.root.data) ? previewInTab.dock.grid.root.data[0] : undefined
    if (!first || Array.isArray(first.data)) throw new Error('缺少预览组')
    first.data.views.push('layers')
    expect(() => validateImageEditorDockLayoutV3(previewInTab, definitions)).toThrow('独立停靠')
  })
})
