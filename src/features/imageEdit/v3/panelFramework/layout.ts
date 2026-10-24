import { parseWorkspaceDockLayout, workspacePanelConstraints } from '@/core/workspaceLayouts/validation'
import { Orientation, type DockviewApi, type SerializedDockview } from 'dockview-react'

import type { ImageEditorHostProfileIdV3 } from '../application/imageEditorHostProfiles'
import { imageEditorDockPanelsV3, type ImageEditorPanelDefinitionV3 } from './panelRegistry'

export const IMAGE_EDITOR_PREVIEW_PANEL_V3 = 'preview'

/** 仅为运行时布局 DTO；持久 schema/版本由宿主适配器登记，禁止写进作品。 */
export interface ImageEditorDockLayoutV3 {
  dock: SerializedDockview
  collapsed: readonly string[]
}

/** 同步读预加载视图快照；save 可由宿主排队落盘，失败必须由宿主报告。 */
export interface ImageEditorLayoutStoreV3 {
  load(profileId: ImageEditorHostProfileIdV3): unknown
  save(profileId: ImageEditorHostProfileIdV3, layout: ImageEditorDockLayoutV3): void
}

export function createImageEditorMemoryLayoutStoreV3(): ImageEditorLayoutStoreV3 {
  const layouts = new Map<ImageEditorHostProfileIdV3, ImageEditorDockLayoutV3>()
  return {
    load: profileId => {
      const value = layouts.get(profileId)
      return value ? structuredClone(value) : undefined
    },
    save: (profileId, layout) => { layouts.set(profileId, structuredClone(layout)) },
  }
}

// 旧版会话布局仅供一次性迁入共享服务；正式宿主不再调用 save。
const workspaceLayouts = new Map<string, ImageEditorLayoutStoreV3>()
export function imageEditorWorkspaceLayoutStoreV3(workspaceId: string): ImageEditorLayoutStoreV3 {
  let store = workspaceLayouts.get(workspaceId)
  if (!store) {
    store = createImageEditorMemoryLayoutStoreV3()
    workspaceLayouts.set(workspaceId, store)
  }
  return store
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 限定组件/目标；结构解析仍委托 Dockview.fromJSON，不复制其完整格式。 */
export function validateImageEditorDockLayoutV3(
  value: unknown,
  definitions: readonly ImageEditorPanelDefinitionV3[],
): asserts value is ImageEditorDockLayoutV3 {
  if (!isRecord(value) || !isRecord(value.dock) || !Array.isArray(value.collapsed)) {
    throw new Error('面板布局结构无效')
  }
  const allowed = new Set(definitions.map(({ id }) => id))
  if (value.collapsed.some(id => typeof id !== 'string' || !allowed.has(id))
    || new Set(value.collapsed).size !== value.collapsed.length) throw new Error('折叠面板无效')
  const dock = parseWorkspaceDockLayout(JSON.stringify(value.dock), imageEditorDockPanelsV3(definitions))
  if (!dock.panels.preview) throw new Error('缺少图片预览')
  let previewFound = false
  const inspect = (node: unknown, floating: boolean): void => {
    if (!isRecord(node)) return
    if (node.type === 'branch' && Array.isArray(node.data)) { node.data.forEach(child => inspect(child, floating)); return }
    const group = node.data
    if (!isRecord(group) || !Array.isArray(group.views) || !group.views.includes('preview')) return
    if (floating || group.views.length !== 1 || group.hideHeader !== true || group.locked !== true) throw new Error('图片预览必须独立停靠')
    previewFound = true
  }
  inspect(dock.grid.root, false)
  for (const floating of dock.floatingGroups ?? []) {
    const entry = floating as unknown as Record<string, unknown>
    if (isRecord(entry.grid)) inspect(entry.grid.root, true)
    else inspect({ type: 'leaf', data: entry.data }, true)
  }
  if (!previewFound) throw new Error('图片预览必须独立停靠')

}

export function showImageEditorPanelV3(
  api: DockviewApi,
  definition: ImageEditorPanelDefinitionV3,
  title: string,
): void {
  const existing = api.getPanel(definition.id)
  if (existing) { existing.api.setActive(); return }
  const sibling = api.panels.find(panel => panel.id !== IMAGE_EDITOR_PREVIEW_PANEL_V3 && panel.group.api.location.type === 'grid')
  api.addPanel({
    id: definition.id,
    component: definition.id,
    title,
    position: sibling
      ? { referencePanel: sibling, direction: definition.defaultPlacement === 'tab' ? 'within' : 'below' }
      : { referencePanel: IMAGE_EDITOR_PREVIEW_PANEL_V3, direction: 'right' },
    initialWidth: api.width > 0 ? Math.min(400, api.width * 0.42) : 400,
    ...workspacePanelConstraints(imageEditorDockPanelsV3([definition]), definition.id),
  })
}

export function defaultImageEditorLayout(definitions: readonly ImageEditorPanelDefinitionV3[], focus = false): SerializedDockview {
  const groups: { type: 'leaf'; size: number; data: { id: string; views: string[]; activeView: string } }[] = []
  for (const panel of definitions) {
    if (groups.length && (focus || panel.defaultPlacement === 'tab')) groups[0].data.views.push(panel.id)
    else groups.push({ type: 'leaf', size: 280, data: { id: `image-${panel.id}`, views: [panel.id], activeView: panel.id } })
  }
  return {
    grid: { width: 1440, height: 860, orientation: Orientation.HORIZONTAL, root: { type: 'branch', data: [
      { type: 'leaf', size: focus ? 1200 : 1040, data: { id: 'image-preview', views: ['preview'], activeView: 'preview', locked: true, hideHeader: true } },
      ...(groups.length ? [{ type: 'branch' as const, size: focus ? 240 : 400, data: groups }] : []),
    ] } },
    panels: Object.fromEntries([{ id: 'preview', title: '画布' }, ...definitions].map(({ id, title }) => [id, { id, title, contentComponent: id, renderer: 'always' as const }])),
    activeGroup: 'image-preview',
  }
}

/** 默认布局构造保留为宿主及测试入口；用户重置走共享 resetActive。 */
export function resetImageEditorDockLayoutV3(
  api: DockviewApi,
  definitions: readonly ImageEditorPanelDefinitionV3[],
  title: (definition: ImageEditorPanelDefinitionV3) => string,
): void {
  api.fromJSON(defaultImageEditorLayout(definitions.map(definition => ({ ...definition, title: title(definition) }))), { reuseExistingPanels: true })
}
