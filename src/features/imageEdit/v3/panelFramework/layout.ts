import type { DockviewApi, SerializedDockview } from 'dockview-react'

import type { ImageEditorHostProfileIdV3 } from '../application/imageEditorHostProfiles'
import type { ImageEditorPanelDefinitionV3 } from './panelRegistry'

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

// 应用会话偏好按工作区隔离；编辑器卸载后仍保留，退出应用后释放。
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
  const dock = value.dock
  if (!isRecord(dock.panels) || !isRecord(dock.grid)
    || !Number.isFinite(dock.grid.width) || !Number.isFinite(dock.grid.height)
    || Number(dock.grid.width) < 0 || Number(dock.grid.height) < 0
    || !['HORIZONTAL', 'VERTICAL'].includes(String(dock.grid.orientation))) {
    throw new Error('停靠网格无效')
  }
  const ids = Object.keys(dock.panels)
  if (!ids.includes(IMAGE_EDITOR_PREVIEW_PANEL_V3)) throw new Error('缺少图片预览')
  for (const id of ids) {
    const panel = dock.panels[id]
    if ((id !== IMAGE_EDITOR_PREVIEW_PANEL_V3 && !allowed.has(id))
      || !isRecord(panel) || panel.id !== id || panel.contentComponent !== id) {
      throw new Error(`面板不属于当前宿主：${id}`)
    }
  }
  // 系统浮窗和 edgeGroup 不属于本任务宿主，禁止借布局导入打开外部窗口。
  if (dock.popoutGroups !== undefined || dock.edgeGroups !== undefined) throw new Error('不支持此停靠位置')
  if (dock.floatingGroups !== undefined && !Array.isArray(dock.floatingGroups)) throw new Error('浮动布局无效')
  const nodes: { node: unknown; floating: boolean }[] = [{ node: dock.grid.root, floating: false }]
  const seenNodes = new Set<unknown>()
  const used = new Set<string>()
  const groups = new Set<string>()
  let gridPreview = false
  const collect = (data: unknown, floating: boolean): void => {
    if (!isRecord(data) || typeof data.id !== 'string' || groups.has(data.id)
      || !Array.isArray(data.views) || !data.views.length) throw new Error('面板组无效')
    groups.add(data.id)
    for (const id of data.views) {
      if (typeof id !== 'string' || !ids.includes(id) || used.has(id)) throw new Error('面板组引用无效')
      if (id === IMAGE_EDITOR_PREVIEW_PANEL_V3) {
        if (floating || data.views.length !== 1 || data.hideHeader !== true || data.locked !== true) throw new Error('图片预览必须独立停靠')
        gridPreview = true
      }
      used.add(id)
    }
    if (data.activeView !== undefined && !data.views.includes(data.activeView)) throw new Error('当前标签无效')
  }
  for (const floating of dock.floatingGroups ?? []) {
    if (!isRecord(floating) || !isRecord(floating.position)) throw new Error('浮动位置无效')
    const position = floating.position
    for (const coordinate of ['width', 'height']) {
      if (!Number.isFinite(position[coordinate])) throw new Error('浮动位置无效')
    }
    if (['left', 'right', 'top', 'bottom'].some(key => position[key] !== undefined && !Number.isFinite(position[key]))
      || ![position.left, position.right].some(Number.isFinite)
      || ![position.top, position.bottom].some(Number.isFinite)) throw new Error('浮动锚点无效')
    if (Number(position.width) <= 0 || Number(position.height) <= 0) throw new Error('浮动尺寸无效')
    if (floating.grid !== undefined) {
      if (!isRecord(floating.grid)) throw new Error('浮动网格无效')
      nodes.push({ node: floating.grid.root, floating: true })
    } else collect(floating.data, true)
  }
  while (nodes.length) {
    const entry = nodes.pop()!
    const node = entry.node
    if (!isRecord(node) || seenNodes.has(node)) throw new Error('停靠节点无效')
    seenNodes.add(node)
    if (node.size !== undefined && (!Number.isFinite(node.size) || Number(node.size) < 0)) throw new Error('停靠尺寸无效')
    if (node.type === 'branch' && Array.isArray(node.data)) nodes.push(...node.data.map(node => ({ node, floating: entry.floating })))
    else if (node.type === 'leaf') collect(node.data, entry.floating)
    else throw new Error('停靠节点类型无效')
  }
  if (!gridPreview || used.size !== ids.length) throw new Error('面板布局引用不完整')
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
  })
}

export function resetImageEditorDockLayoutV3(
  api: DockviewApi,
  definitions: readonly ImageEditorPanelDefinitionV3[],
  title: (definition: ImageEditorPanelDefinitionV3) => string,
): void {
  const preview = api.getPanel(IMAGE_EDITOR_PREVIEW_PANEL_V3)
  if (preview && preview.group.api.location.type === 'grid') {
    // 恢复布局不能重建预览：保留正在编辑的画面、GPU 租约与工具会话。
    for (const panel of [...api.panels]) if (panel !== preview) api.removePanel(panel)
  } else {
    api.clear()
    const previewGroup = api.addGroup({ direction: 'right', id: 'image-preview', locked: true, hideHeader: true })
    api.addPanel({ id: IMAGE_EDITOR_PREVIEW_PANEL_V3, component: IMAGE_EDITOR_PREVIEW_PANEL_V3, renderer: 'always', position: { referenceGroup: previewGroup, direction: 'within' } })
  }
  for (const definition of definitions) showImageEditorPanelV3(api, definition, title(definition))
  // 同组新增标签不抢走该组默认面板的焦点；历史仍可从标签或面板菜单打开。
  const activeGroups = new Set<string>()
  for (const definition of definitions) {
    const panel = api.getPanel(definition.id)
    if (panel && !activeGroups.has(panel.group.id)) { activeGroups.add(panel.group.id); panel.api.setActive() }
  }
  api.getPanel(IMAGE_EDITOR_PREVIEW_PANEL_V3)?.api.setActive()
}
