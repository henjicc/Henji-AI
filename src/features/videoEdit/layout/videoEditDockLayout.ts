import { Orientation, type DockviewApi, type DockviewGroupPanel, type IDockviewPanel, type SerializedDockview } from 'dockview-react'
import { createLogger } from '@/core/logging'

const logger = createLogger('features.videoEdit.layout')
export const VIDEO_EDIT_LAYOUT_STORAGE_KEY = 'henji.videoEdit.dockLayout.v1'
export const VIDEO_EDIT_PANELS = [
  { id: 'project', title: '项目素材' },
  { id: 'program', title: '节目画面' },
  { id: 'effects', title: '效果控件' },
  { id: 'timeline', title: '时间线' },
] as const
export type VideoEditPanelId = typeof VIDEO_EDIT_PANELS[number]['id']

/** A view-only layout: no project content, selection or transport state is serialized. */
export function defaultVideoEditLayout(): SerializedDockview {
  const panels = Object.fromEntries(VIDEO_EDIT_PANELS.map(({ id, title }) => [id, { id, contentComponent: id, title, renderer: 'always' as const }]))
  return {
    grid: {
      width: 1440, height: 860, orientation: Orientation.HORIZONTAL,
      root: { type: 'branch', data: [
        { type: 'leaf', size: 240, data: { id: 'project-group', views: ['project'], activeView: 'project' } },
        { type: 'branch', size: 920, data: [
          { type: 'leaf', size: 540, data: { id: 'program-group', views: ['program'], activeView: 'program' } },
          { type: 'leaf', size: 320, data: { id: 'timeline-group', views: ['timeline'], activeView: 'timeline' } },
        ] },
        { type: 'leaf', size: 280, data: { id: 'effects-group', views: ['effects'], activeView: 'effects' } },
      ] },
    }, panels, activeGroup: 'program-group',
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function finitePositive(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value > 0 }

/** Reject unknown renderers, duplicate program views and system-window state before Dockview sees them. */
export function parseVideoEditLayout(raw: string): SerializedDockview {
  const value: unknown = JSON.parse(raw)
  if (!isRecord(value) || !isRecord(value.grid) || !isRecord(value.panels) || value.popoutGroups !== undefined || value.edgeGroups !== undefined) throw new Error('不支持的剪辑布局')
  const { grid, panels } = value
  if (!finitePositive(grid.width) || !finitePositive(grid.height) || ![Orientation.HORIZONTAL, Orientation.VERTICAL].includes(grid.orientation as Orientation)) throw new Error('无效的布局尺寸')
  const known = new Set<string>(VIDEO_EDIT_PANELS.map(panel => panel.id))
  for (const [id, panel] of Object.entries(panels)) {
    if (!known.has(id) || !isRecord(panel) || panel.id !== id || panel.contentComponent !== id) throw new Error('无效的剪辑面板')
    // Inactive tabs retain a single mounted view, including its preview session.
    panel.renderer = 'always'
  }
  const seen = new Set<string>()
  const groups = new Set<string>()
  const checkGroup = (group: unknown): void => {
    if (!isRecord(group) || typeof group.id !== 'string' || groups.has(group.id) || !Array.isArray(group.views)) throw new Error('无效的面板分组')
    groups.add(group.id)
    for (const id of group.views) {
      if (typeof id !== 'string' || !known.has(id) || seen.has(id) || !panels[id]) throw new Error('重复或缺失的剪辑面板')
      seen.add(id)
    }
    if (group.activeView !== undefined && !group.views.includes(group.activeView)) throw new Error('无效的活动面板')
  }
  const checkNode = (node: unknown, depth = 0): void => {
    if (!isRecord(node) || depth > 8 || (node.size !== undefined && !finitePositive(node.size))) throw new Error('无效的布局节点')
    if (node.type === 'leaf') checkGroup(node.data)
    else if (node.type === 'branch' && Array.isArray(node.data)) node.data.forEach(child => checkNode(child, depth + 1))
    else throw new Error('无效的布局节点')
  }
  if (!isRecord(grid.root) || grid.root.type !== 'branch') throw new Error('无效的布局根节点')
  checkNode(grid.root)
  if (value.floatingGroups !== undefined) {
    if (!Array.isArray(value.floatingGroups)) throw new Error('无效的浮动面板')
    for (const floating of value.floatingGroups) {
      if (!isRecord(floating) || !isRecord(floating.position) || !finitePositive(floating.position.width) || !finitePositive(floating.position.height)) throw new Error('无效的浮动面板尺寸')
      const position = floating.position
      if (!['top', 'bottom'].some(key => typeof position[key] === 'number' && Number.isFinite(position[key])) || !['left', 'right'].some(key => typeof position[key] === 'number' && Number.isFinite(position[key]))) throw new Error('无效的浮动面板位置')
      if (floating.grid !== undefined && isRecord(floating.grid)) checkNode(floating.grid.root)
      else checkGroup(floating.data)
    }
  }
  if (seen.size !== Object.keys(panels).length) throw new Error('布局含有未挂载面板')
  return value as unknown as SerializedDockview
}

export function restoreVideoEditLayout(api: DockviewApi, storage: Pick<Storage, 'getItem'> = localStorage): void {
  try {
    const saved = storage.getItem(VIDEO_EDIT_LAYOUT_STORAGE_KEY)
    api.fromJSON(saved ? parseVideoEditLayout(saved) : defaultVideoEditLayout(), { reuseExistingPanels: true })
  } catch (error) {
    logger.warn('剪辑布局恢复失败，恢复默认布局', { event: 'video_edit.layout.restore.failed', error })
    api.fromJSON(defaultVideoEditLayout(), { reuseExistingPanels: true })
  }
}

export function saveVideoEditLayout(api: DockviewApi, storage: Pick<Storage, 'setItem'> = localStorage): void {
  storage.setItem(VIDEO_EDIT_LAYOUT_STORAGE_KEY, JSON.stringify(api.toJSON()))
}

export function resetVideoEditLayout(api: DockviewApi): void {
  // reuseExistingPanels keeps mounted preview and timeline components during reset.
  api.fromJSON(defaultVideoEditLayout(), { reuseExistingPanels: true })
}

export function showVideoEditPanel(api: DockviewApi, id: VideoEditPanelId): IDockviewPanel {
  const existing = api.getPanel(id)
  if (existing) { existing.api.setActive(); return existing }
  const definition = VIDEO_EDIT_PANELS.find(panel => panel.id === id)!
  const reference = api.getPanel('program') ?? api.panels.find(panel => panel.api.location.type === 'grid')
  return api.addPanel({ id, component: id, title: definition.title, renderer: 'always',
    ...(reference ? { position: { referencePanel: reference, direction: id === 'timeline' ? 'below' : id === 'project' ? 'left' : 'right' } } : {}),
    ...(id === 'timeline' ? { initialHeight: 320 } : id === 'program' ? {} : { initialWidth: 280 }),
  })
}

export function dockVideoEditPanel(api: DockviewApi, panel: IDockviewPanel): void {
  const target = api.groups.find(group => group !== panel.group && group.api.location.type === 'grid')
    ?? api.addGroup({ direction: 'right' })
  panel.api.moveTo({ group: target, position: target.panels.length ? 'right' : 'center' })
}

export function dockVideoEditGroup(api: DockviewApi, group: DockviewGroupPanel): void {
  const target = api.groups.find(other => other !== group && other.api.location.type === 'grid')
  group.api.moveTo(target ? { group: target, position: 'right' } : { position: 'right' })
}
